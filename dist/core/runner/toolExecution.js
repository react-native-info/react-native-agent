import { setAgentToolParentRunConfigOnDetails } from '../agentToolRunConfig';
import { consumeAgentToolRunResult } from '../agentToolRunResults';
import { ToolCallError, ToolTimeoutError, UserError } from '../errors';
import { getTransferMessage } from '../handoff';
import { RunHandoffCallItem, RunHandoffOutputItem, RunMessageOutputItem, RunToolApprovalItem, RunToolCallOutputItem, } from '../items';
import { assistant } from '../helpers/message';
import logger from '../logger';
import { invokeFunctionTool, resolveComputer, } from '../tool';
import { encodeUint8ArrayToBase64 } from '../utils/base64';
import { toSmartString } from '../utils/smartString';
import { isZodObject } from '../utils';
import { withFunctionSpan, withHandoffSpan } from '../tracing/createSpans';
import { getCurrentTrace } from '../tracing/context';
import { getFunctionToolQualifiedName, matchesFunctionToolName, } from '../toolIdentity';
import { runToolInputGuardrails, runToolOutputGuardrails, } from '../utils/toolGuardrails';
import { resolveApprovalRejectionMessage, TOOL_APPROVAL_REJECTION_MESSAGE, } from './approvalRejection';
import { SingleStepResult } from './steps';
const REDACTED_TOOL_ERROR_MESSAGE = 'Tool execution failed. Error details are redacted.';
// 1x1 transparent PNG data URL used for rejected computer actions.
const TOOL_APPROVAL_REJECTION_SCREENSHOT_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
function getFunctionToolIdentity(toolRun) {
    return getFunctionToolQualifiedName(toolRun.tool) ?? toolRun.tool.name;
}
function getFunctionToolTraceName(toolRun) {
    return getFunctionToolIdentity(toolRun);
}
const COMPUTER_TRACE_NAME = 'computer';
function getComputerToolActions(toolCall) {
    if (Array.isArray(toolCall.actions) && toolCall.actions.length > 0) {
        return toolCall.actions;
    }
    return toolCall.action ? [toolCall.action] : [];
}
function getComputerTraceInputPayload(toolCall) {
    const actions = getComputerToolActions(toolCall);
    if (Array.isArray(toolCall.actions) && toolCall.actions.length > 0) {
        return actions;
    }
    return actions[0];
}
/**
 * @internal
 * Normalizes tool outputs once so downstream code works with fully structured protocol items.
 * Doing this here keeps API surface stable even when providers add new shapes.
 */
export function getToolCallOutputItem(toolCall, output) {
    const maybeStructuredOutputs = normalizeStructuredToolOutputs(output);
    if (maybeStructuredOutputs) {
        const structuredItems = maybeStructuredOutputs.map(convertStructuredToolOutputToInputItem);
        return {
            type: 'function_call_result',
            name: toolCall.name,
            ...(typeof toolCall.namespace === 'string'
                ? { namespace: toolCall.namespace }
                : {}),
            callId: toolCall.callId,
            status: 'completed',
            output: structuredItems,
        };
    }
    return {
        type: 'function_call_result',
        name: toolCall.name,
        ...(typeof toolCall.namespace === 'string'
            ? { namespace: toolCall.namespace }
            : {}),
        callId: toolCall.callId,
        status: 'completed',
        output: {
            type: 'text',
            text: toSmartString(output),
        },
    };
}
/**
 * @internal
 * Runs every function tool call requested by the model and returns their outputs alongside
 * the `RunItem` instances that should be appended to history.
 */
export async function executeFunctionToolCalls(agent, toolRuns, runner, state, toolErrorFormatter) {
    const deps = {
        agent,
        runner,
        state,
        toolErrorFormatter,
    };
    try {
        const results = await Promise.all(toolRuns.map(async (toolRun) => {
            const parseResult = parseToolArguments(toolRun);
            // Handle parse errors gracefully instead of crashing
            if (!parseResult.success) {
                return buildParseErrorResult(deps, toolRun, parseResult.error);
            }
            const approvalOutcome = await handleFunctionApproval(deps, toolRun, parseResult.args);
            if (approvalOutcome !== 'approved') {
                return approvalOutcome;
            }
            return runApprovedFunctionTool(deps, toolRun);
        }));
        return results;
    }
    catch (e) {
        if (e instanceof ToolTimeoutError) {
            e.state ??= state;
            throw e;
        }
        throw new ToolCallError(`Failed to run function tools: ${e}`, e, state);
    }
}
function parseToolArguments(toolRun) {
    const toolName = getFunctionToolIdentity(toolRun);
    try {
        let parsedArgs = toolRun.toolCall.arguments;
        if (toolRun.tool.parameters) {
            if (isZodObject(toolRun.tool.parameters)) {
                parsedArgs = toolRun.tool.parameters.parse(parsedArgs);
            }
            else {
                parsedArgs = JSON.parse(parsedArgs);
            }
        }
        return { success: true, args: parsedArgs };
    }
    catch (error) {
        logger.debug(`Failed to parse tool arguments for ${toolName}: ${error}`);
        return { success: false, error: error };
    }
}
function buildApprovalRequestResult(deps, toolRun) {
    return {
        type: 'function_approval',
        tool: toolRun.tool,
        runItem: new RunToolApprovalItem(toolRun.toolCall, deps.agent, getFunctionToolIdentity(toolRun)),
    };
}
function buildParseErrorResult(deps, toolRun, error) {
    const errorMessage = `An error occurred while parsing tool arguments. Please try again with valid JSON. Error: ${error.message}`;
    return {
        type: 'function_output',
        tool: toolRun.tool,
        output: errorMessage,
        runItem: new RunToolCallOutputItem(getToolCallOutputItem(toolRun.toolCall, errorMessage), deps.agent, errorMessage),
    };
}
async function buildApprovalRejectionResult(deps, toolRun) {
    const { agent, runner, state, toolErrorFormatter } = deps;
    const toolName = getFunctionToolIdentity(toolRun);
    const traceToolName = getFunctionToolTraceName(toolRun);
    return withToolFunctionSpan(runner, traceToolName, async (span) => {
        const response = await resolveApprovalRejectionMessage({
            runContext: state._context,
            toolType: 'function',
            toolName,
            callId: toolRun.toolCall.callId,
            toolErrorFormatter,
        });
        const traceErrorMessage = runner.config.traceIncludeSensitiveData
            ? response
            : TOOL_APPROVAL_REJECTION_MESSAGE;
        span?.setError({
            message: traceErrorMessage,
            data: {
                tool_name: traceToolName,
                error: `Tool execution for ${toolRun.toolCall.callId} was manually rejected by user.`,
            },
        });
        if (span && runner.config.traceIncludeSensitiveData) {
            span.spanData.output = response;
        }
        return {
            type: 'function_output',
            tool: toolRun.tool,
            output: response,
            runItem: new RunToolCallOutputItem(getToolCallOutputItem(toolRun.toolCall, response), agent, response),
        };
    });
}
async function handleFunctionApproval(deps, toolRun, parsedArgs) {
    const { state } = deps;
    const toolName = getFunctionToolIdentity(toolRun);
    const needsApproval = await toolRun.tool.needsApproval(state._context, parsedArgs, toolRun.toolCall.callId);
    if (!needsApproval) {
        return 'approved';
    }
    const approval = state._context.isToolApproved({
        toolName,
        callId: toolRun.toolCall.callId,
    });
    if (approval === false) {
        state.clearPendingAgentToolRun(toolName, toolRun.toolCall.callId);
        return await buildApprovalRejectionResult(deps, toolRun);
    }
    if (approval !== true) {
        return buildApprovalRequestResult(deps, toolRun);
    }
    return 'approved';
}
async function runApprovedFunctionTool(deps, toolRun) {
    const { agent, runner, state } = deps;
    const toolName = getFunctionToolIdentity(toolRun);
    const traceToolName = getFunctionToolTraceName(toolRun);
    return withToolFunctionSpan(runner, traceToolName, async (span) => {
        if (span && runner.config.traceIncludeSensitiveData) {
            span.spanData.input = toolRun.toolCall.arguments;
        }
        try {
            const inputGuardrailResult = await runToolInputGuardrails({
                guardrails: toolRun.tool.inputGuardrails,
                context: state._context,
                agent,
                toolCall: toolRun.toolCall,
                onResult: (result) => {
                    state._toolInputGuardrailResults.push(result);
                },
            });
            emitToolStart(runner, state._context, agent, toolRun.tool, toolRun.toolCall);
            let toolOutput;
            if (inputGuardrailResult.type === 'reject') {
                toolOutput = inputGuardrailResult.message;
            }
            else {
                const resumeState = state.getPendingAgentToolRun(toolName, toolRun.toolCall.callId);
                const toolDetails = {
                    toolCall: toolRun.toolCall,
                    resumeState,
                };
                setAgentToolParentRunConfigOnDetails(toolDetails, runner.config);
                toolOutput = await invokeFunctionTool({
                    tool: toolRun.tool,
                    runContext: state._context,
                    input: toolRun.toolCall.arguments,
                    details: toolDetails,
                });
                toolOutput = await runToolOutputGuardrails({
                    guardrails: toolRun.tool.outputGuardrails,
                    context: state._context,
                    agent,
                    toolCall: toolRun.toolCall,
                    toolOutput,
                    onResult: (result) => {
                        state._toolOutputGuardrailResults.push(result);
                    },
                });
            }
            const stringResult = toSmartString(toolOutput);
            emitToolEnd(runner, state._context, agent, toolRun.tool, stringResult, toolRun.toolCall);
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.output = stringResult;
            }
            const functionResult = {
                type: 'function_output',
                tool: toolRun.tool,
                output: toolOutput,
                runItem: new RunToolCallOutputItem(getToolCallOutputItem(toolRun.toolCall, toolOutput), agent, toolOutput),
            };
            const nestedRunResult = consumeAgentToolRunResult(toolRun.toolCall);
            if (nestedRunResult) {
                functionResult.agentRunResult = nestedRunResult;
                const nestedInterruptions = nestedRunResult.interruptions;
                if (nestedInterruptions.length > 0) {
                    functionResult.interruptions = nestedInterruptions;
                    const nestedRunStateJson = nestedRunResult.state.toJSON();
                    state.setPendingAgentToolRun(toolName, toolRun.toolCall.callId, JSON.stringify(nestedRunStateJson));
                }
                else {
                    state.clearPendingAgentToolRun(toolName, toolRun.toolCall.callId);
                }
            }
            return functionResult;
        }
        catch (error) {
            span?.setError({
                message: 'Error running tool',
                data: {
                    tool_name: traceToolName,
                    error: String(error),
                },
            });
            const errorResult = String(error);
            emitToolEnd(runner, state._context, agent, toolRun.tool, errorResult, toolRun.toolCall);
            throw error;
        }
    });
}
/**
 * @internal
 */
// Internal helper: dispatch a computer action and return a screenshot (sync/async)
async function _runComputerActionAndScreenshot(computer, toolCall, runContext) {
    for (const action of getComputerToolActions(toolCall)) {
        switch (action.type) {
            case 'click':
                await computer.click(action.x, action.y, action.button, runContext);
                break;
            case 'double_click':
                await computer.doubleClick(action.x, action.y, runContext);
                break;
            case 'drag':
                await computer.drag(action.path.map((p) => [p.x, p.y]), runContext);
                break;
            case 'keypress':
                await computer.keypress(action.keys, runContext);
                break;
            case 'move':
                await computer.move(action.x, action.y, runContext);
                break;
            case 'screenshot':
                await computer.screenshot(runContext);
                break;
            case 'scroll':
                await computer.scroll(action.x, action.y, action.scroll_x, action.scroll_y, runContext);
                break;
            case 'type':
                await computer.type(action.text, runContext);
                break;
            case 'wait':
                await computer.wait(runContext);
                break;
            default:
                action;
                break;
        }
    }
    if (typeof computer.screenshot === 'function') {
        const screenshot = await computer.screenshot(runContext);
        if (typeof screenshot !== 'undefined') {
            return screenshot;
        }
    }
    throw new Error('Computer does not implement screenshot()');
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message || error.toString();
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
function getTraceToolError(traceIncludeSensitiveData, errorMessage) {
    return traceIncludeSensitiveData ? errorMessage : REDACTED_TOOL_ERROR_MESSAGE;
}
async function withToolFunctionSpan(runner, toolName, fn) {
    if (runner.config.tracingDisabled || !getCurrentTrace()) {
        return fn();
    }
    return withFunctionSpan(async (span) => fn(span), {
        data: {
            name: toolName,
        },
    });
}
async function resolveToolApproval(options) {
    const { runContext, toolName, callId, approvalItem, needsApproval, onApproval, } = options;
    if (!needsApproval) {
        return 'approved';
    }
    if (onApproval) {
        const decision = await onApproval(runContext, approvalItem);
        if (decision.approve === true) {
            runContext.approveTool(approvalItem);
        }
        else if (decision.approve === false) {
            runContext.rejectTool(approvalItem);
        }
    }
    const approval = runContext.isToolApproved({
        toolName,
        callId,
    });
    if (approval === true) {
        return 'approved';
    }
    if (approval === false) {
        return 'rejected';
    }
    return 'pending';
}
async function handleToolApprovalDecision(options) {
    const { runContext, toolName, callId, approvalItem, needsApproval, onApproval, buildRejectionItem, } = options;
    const approvalState = await resolveToolApproval({
        runContext,
        toolName,
        callId,
        approvalItem,
        needsApproval,
        onApproval,
    });
    if (approvalState === 'rejected') {
        return { status: 'rejected', item: await buildRejectionItem() };
    }
    if (approvalState === 'pending') {
        return { status: 'pending', item: approvalItem };
    }
    return { status: 'approved' };
}
function emitToolStart(runner, runContext, agent, tool, toolCall) {
    runner.emit('agent_tool_start', runContext, agent, tool, { toolCall });
    if (typeof agent.emit === 'function') {
        agent.emit('agent_tool_start', runContext, tool, { toolCall });
    }
}
function emitToolEnd(runner, runContext, agent, tool, output, toolCall) {
    runner.emit('agent_tool_end', runContext, agent, tool, output, { toolCall });
    if (typeof agent.emit === 'function') {
        agent.emit('agent_tool_end', runContext, tool, output, { toolCall });
    }
}
export async function executeShellActions(agent, actions, runner, runContext, customLogger = undefined, toolErrorFormatter) {
    const _logger = customLogger ?? logger;
    const results = [];
    for (const action of actions) {
        const shellTool = action.shell;
        const toolCall = action.toolCall;
        if (!shellTool.shell) {
            _logger.warn(`Skipping shell action for tool "${shellTool.name}" because no local shell implementation is configured.`);
            continue;
        }
        const approvalItem = new RunToolApprovalItem(toolCall, agent, shellTool.name);
        const approvalDecision = await handleToolApprovalDecision({
            runContext,
            toolName: shellTool.name,
            callId: toolCall.callId,
            approvalItem,
            needsApproval: await shellTool.needsApproval(runContext, toolCall.action, toolCall.callId),
            onApproval: shellTool.onApproval,
            buildRejectionItem: async () => {
                const response = await resolveApprovalRejectionMessage({
                    runContext,
                    toolType: 'shell',
                    toolName: shellTool.name,
                    callId: toolCall.callId,
                    toolErrorFormatter,
                });
                const rejectionOutput = {
                    stdout: '',
                    stderr: response,
                    outcome: { type: 'exit', exitCode: null },
                };
                return new RunToolCallOutputItem({
                    type: 'shell_call_output',
                    callId: toolCall.callId,
                    output: [rejectionOutput],
                }, agent, response);
            },
        });
        if (approvalDecision.status !== 'approved') {
            results.push(approvalDecision.item);
            continue;
        }
        const shellItem = await withToolFunctionSpan(runner, shellTool.name, async (span) => {
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.input = JSON.stringify(toolCall.action);
            }
            emitToolStart(runner, runContext, agent, shellTool, toolCall);
            let shellOutputs;
            const providerMeta = {};
            let maxOutputLength;
            try {
                const shellResult = await shellTool.shell.run(toolCall.action);
                shellOutputs = shellResult.output ?? [];
                if (shellResult.providerData) {
                    Object.assign(providerMeta, shellResult.providerData);
                }
                if (typeof shellResult.maxOutputLength === 'number') {
                    maxOutputLength = shellResult.maxOutputLength;
                }
            }
            catch (err) {
                const errorText = toErrorMessage(err);
                const traceError = getTraceToolError(runner.config.traceIncludeSensitiveData, errorText);
                shellOutputs = [
                    {
                        stdout: '',
                        stderr: errorText,
                        outcome: { type: 'exit', exitCode: null },
                    },
                ];
                span?.setError({
                    message: 'Error running tool',
                    data: {
                        tool_name: shellTool.name,
                        error: traceError,
                    },
                });
                _logger.error('Failed to execute shell action:', err);
            }
            shellOutputs = shellOutputs ?? [];
            const output = JSON.stringify(shellOutputs);
            emitToolEnd(runner, runContext, agent, shellTool, output, toolCall);
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.output = output;
            }
            const rawItem = {
                type: 'shell_call_output',
                callId: toolCall.callId,
                output: shellOutputs ?? [],
            };
            if (typeof maxOutputLength === 'number') {
                rawItem.maxOutputLength = maxOutputLength;
            }
            if (Object.keys(providerMeta).length > 0) {
                rawItem.providerData = providerMeta;
            }
            return new RunToolCallOutputItem(rawItem, agent, rawItem.output);
        });
        results.push(shellItem);
    }
    return results;
}
export async function executeApplyPatchOperations(agent, actions, runner, runContext, customLogger = undefined, toolErrorFormatter) {
    const _logger = customLogger ?? logger;
    const results = [];
    for (const action of actions) {
        const applyPatchTool = action.applyPatch;
        const toolCall = action.toolCall;
        const editorContext = { runContext };
        const approvalItem = new RunToolApprovalItem(toolCall, agent, applyPatchTool.name);
        const approvalDecision = await handleToolApprovalDecision({
            runContext,
            toolName: applyPatchTool.name,
            callId: toolCall.callId,
            approvalItem,
            needsApproval: await applyPatchTool.needsApproval(runContext, toolCall.operation, toolCall.callId),
            onApproval: applyPatchTool.onApproval,
            buildRejectionItem: async () => {
                const response = await resolveApprovalRejectionMessage({
                    runContext,
                    toolType: 'apply_patch',
                    toolName: applyPatchTool.name,
                    callId: toolCall.callId,
                    toolErrorFormatter,
                });
                return new RunToolCallOutputItem({
                    type: 'apply_patch_call_output',
                    callId: toolCall.callId,
                    status: 'failed',
                    output: response,
                }, agent, response);
            },
        });
        if (approvalDecision.status !== 'approved') {
            results.push(approvalDecision.item);
            continue;
        }
        const applyPatchItem = await withToolFunctionSpan(runner, applyPatchTool.name, async (span) => {
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.input = JSON.stringify(toolCall.operation);
            }
            emitToolStart(runner, runContext, agent, applyPatchTool, toolCall);
            let status = 'completed';
            let output = '';
            try {
                let result;
                switch (toolCall.operation.type) {
                    case 'create_file':
                        result = await applyPatchTool.editor.createFile(toolCall.operation, editorContext);
                        break;
                    case 'update_file':
                        result = await applyPatchTool.editor.updateFile(toolCall.operation, editorContext);
                        break;
                    case 'delete_file':
                        result = await applyPatchTool.editor.deleteFile(toolCall.operation, editorContext);
                        break;
                    default:
                        throw new Error('Unsupported apply_patch operation');
                }
                if (result && typeof result.status === 'string') {
                    status = result.status;
                }
                if (result && typeof result.output === 'string') {
                    output = result.output;
                }
            }
            catch (err) {
                status = 'failed';
                output = toErrorMessage(err);
                const traceError = getTraceToolError(runner.config.traceIncludeSensitiveData, output);
                span?.setError({
                    message: 'Error running tool',
                    data: {
                        tool_name: applyPatchTool.name,
                        error: traceError,
                    },
                });
                _logger.error('Failed to execute apply_patch operation:', err);
            }
            emitToolEnd(runner, runContext, agent, applyPatchTool, output, toolCall);
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.output = output;
            }
            const rawItem = {
                type: 'apply_patch_call_output',
                callId: toolCall.callId,
                status,
            };
            if (output) {
                rawItem.output = output;
            }
            return new RunToolCallOutputItem(rawItem, agent, output);
        });
        results.push(applyPatchItem);
    }
    return results;
}
/**
 * @internal
 * Executes any computer-use actions emitted by the model and returns the resulting items so
 * the run history reflects the computer session.
 */
export async function executeComputerActions(agent, actions, runner, runContext, customLogger = undefined, toolErrorFormatter) {
    const _logger = customLogger ?? logger;
    const results = [];
    for (const action of actions) {
        const toolCall = action.toolCall;
        const computerTool = action.computer;
        const computerActions = getComputerToolActions(toolCall);
        let cachedRejectionMessage;
        const getRejectionMessage = async () => {
            if (typeof cachedRejectionMessage === 'string') {
                return cachedRejectionMessage;
            }
            cachedRejectionMessage = await resolveApprovalRejectionMessage({
                runContext,
                toolType: 'computer',
                toolName: computerTool.name,
                callId: toolCall.callId,
                toolErrorFormatter,
            });
            return cachedRejectionMessage;
        };
        const pendingSafetyChecks = getPendingSafetyChecks(toolCall);
        const approvalItem = new RunToolApprovalItem(toolCall, agent, computerTool.name);
        const needsApprovalCandidate = computerTool
            .needsApproval;
        const needsApproval = typeof needsApprovalCandidate === 'function'
            ? (await Promise.all(computerActions.map((computerAction) => needsApprovalCandidate(runContext, computerAction, toolCall.callId)))).some(Boolean)
            : typeof needsApprovalCandidate === 'boolean'
                ? needsApprovalCandidate
                : false;
        const approvalDecision = await handleToolApprovalDecision({
            runContext,
            toolName: computerTool.name,
            callId: toolCall.callId,
            approvalItem,
            needsApproval,
            buildRejectionItem: async () => {
                const rejectionMessage = await getRejectionMessage();
                const rejectionOutput = {
                    type: 'computer_screenshot',
                    data: TOOL_APPROVAL_REJECTION_SCREENSHOT_DATA_URL,
                    providerData: {
                        approvalStatus: 'rejected',
                        message: rejectionMessage,
                    },
                };
                const rawItem = {
                    type: 'computer_call_result',
                    callId: toolCall.callId,
                    output: rejectionOutput,
                };
                return new RunToolCallOutputItem(rawItem, agent, TOOL_APPROVAL_REJECTION_SCREENSHOT_DATA_URL);
            },
        });
        if (approvalDecision.status === 'rejected') {
            const rejectionMessage = await getRejectionMessage();
            results.push(approvalDecision.item);
            results.push(new RunMessageOutputItem(assistant(rejectionMessage), agent));
            continue;
        }
        if (approvalDecision.status === 'pending') {
            results.push(approvalDecision.item);
            continue;
        }
        const computerItem = await withToolFunctionSpan(runner, COMPUTER_TRACE_NAME, async (span) => {
            if (span && runner.config.traceIncludeSensitiveData) {
                const traceInput = getComputerTraceInputPayload(toolCall);
                span.spanData.input =
                    typeof traceInput === 'undefined' ? '' : JSON.stringify(traceInput);
            }
            // Hooks: on_tool_start (global + agent)
            emitToolStart(runner, runContext, agent, computerTool, toolCall);
            const acknowledgedSafetyChecks = pendingSafetyChecks && pendingSafetyChecks.length > 0
                ? await resolveSafetyCheckAcknowledgements({
                    runContext,
                    toolCall,
                    pendingSafetyChecks,
                    onSafetyCheck: computerTool.onSafetyCheck,
                })
                : undefined;
            // Run the action and get screenshot.
            let output;
            try {
                const computer = await resolveComputer({
                    tool: computerTool,
                    runContext,
                });
                output = await _runComputerActionAndScreenshot(computer, toolCall, runContext);
            }
            catch (err) {
                _logger.error('Failed to execute computer action:', err);
                output = '';
                const errorText = toErrorMessage(err);
                const traceError = getTraceToolError(runner.config.traceIncludeSensitiveData, errorText);
                span?.setError({
                    message: 'Error running tool',
                    data: {
                        tool_name: COMPUTER_TRACE_NAME,
                        error: traceError,
                    },
                });
            }
            // Hooks: on_tool_end (global + agent)
            emitToolEnd(runner, runContext, agent, computerTool, output, toolCall);
            // Return the screenshot as a data URL when available; fall back to an empty string on failures.
            const imageUrl = output ? `data:image/png;base64,${output}` : '';
            if (span && runner.config.traceIncludeSensitiveData) {
                span.spanData.output = imageUrl;
            }
            const rawItem = {
                type: 'computer_call_result',
                callId: toolCall.callId,
                output: { type: 'computer_screenshot', data: imageUrl },
            };
            if (acknowledgedSafetyChecks && acknowledgedSafetyChecks.length > 0) {
                rawItem.providerData = {
                    acknowledgedSafetyChecks,
                };
            }
            return new RunToolCallOutputItem(rawItem, agent, imageUrl);
        });
        results.push(computerItem);
    }
    return results;
}
/**
 * @internal
 * Drives handoff calls by invoking the downstream agent and capturing any generated items so
 * the current agent can continue with the new context.
 */
export async function executeHandoffCalls(agent, originalInput, preStepItems, newStepItems, newResponse, runHandoffs, runner, runContext) {
    newStepItems = [...newStepItems];
    if (runHandoffs.length === 0) {
        logger.warn('Incorrectly called executeHandoffCalls with no handoffs. This should not happen. Moving on.');
        return new SingleStepResult(originalInput, newResponse, preStepItems, newStepItems, { type: 'next_step_run_again' });
    }
    if (runHandoffs.length > 1) {
        const ignoredCallIds = new Set(runHandoffs.slice(1).map((handoff) => handoff.toolCall.callId));
        // Drop ignored handoff requests from the step so they never persist to history.
        newStepItems = newStepItems.filter((item) => !(item instanceof RunHandoffCallItem &&
            ignoredCallIds.has(item.rawItem.callId)));
    }
    const actualHandoff = runHandoffs[0];
    return withHandoffSpan(async (handoffSpan) => {
        const handoff = actualHandoff.handoff;
        const newAgent = await handoff.onInvokeHandoff(runContext, actualHandoff.toolCall.arguments);
        handoffSpan.spanData.to_agent = newAgent.name;
        if (runHandoffs.length > 1) {
            const requestedAgents = runHandoffs.map((h) => h.handoff.agentName);
            handoffSpan.setError({
                message: 'Multiple handoffs requested',
                data: {
                    requested_agents: requestedAgents,
                },
            });
        }
        newStepItems.push(new RunHandoffOutputItem(getToolCallOutputItem(actualHandoff.toolCall, getTransferMessage(newAgent)), agent, newAgent));
        runner.emit('agent_handoff', runContext, agent, newAgent);
        agent.emit('agent_handoff', runContext, newAgent);
        const inputFilter = handoff.inputFilter ?? runner.config.handoffInputFilter;
        if (inputFilter) {
            logger.debug('Filtering inputs for handoff');
            if (typeof inputFilter !== 'function') {
                handoffSpan.setError({
                    message: 'Invalid input filter',
                    data: {
                        details: 'not callable',
                    },
                });
            }
            const handoffInputData = {
                inputHistory: Array.isArray(originalInput)
                    ? [...originalInput]
                    : originalInput,
                preHandoffItems: [...preStepItems],
                newItems: [...newStepItems],
                runContext,
            };
            const filtered = inputFilter(handoffInputData);
            originalInput = filtered.inputHistory;
            preStepItems = filtered.preHandoffItems;
            newStepItems = filtered.newItems;
        }
        return new SingleStepResult(originalInput, newResponse, preStepItems, newStepItems, { type: 'next_step_handoff', newAgent });
    }, {
        data: {
            from_agent: agent.name,
        },
    });
}
const NOT_FINAL_OUTPUT = {
    isFinalOutput: false,
    isInterrupted: undefined,
};
/**
 * Collects approval interruptions from tool execution results and any additional
 * RunItems (e.g., shell/apply_patch approval placeholders).
 */
export function collectInterruptions(toolResults, additionalItems = []) {
    const interruptions = [];
    for (const item of additionalItems) {
        if (item instanceof RunToolApprovalItem) {
            interruptions.push(item);
        }
    }
    for (const result of toolResults) {
        if (result.runItem instanceof RunToolApprovalItem) {
            interruptions.push(result.runItem);
        }
        if (result.type === 'function_output') {
            if (Array.isArray(result.interruptions)) {
                interruptions.push(...result.interruptions);
            }
            else if (result.agentRunResult) {
                const nestedInterruptions = result.agentRunResult.interruptions;
                if (nestedInterruptions.length > 0) {
                    interruptions.push(...nestedInterruptions);
                }
            }
        }
    }
    return interruptions;
}
/**
 * @internal
 * Determines whether tool executions produced a final agent output, triggered an interruption,
 * or whether the agent loop should continue collecting more responses.
 */
export async function checkForFinalOutputFromTools(agent, toolResults, state, additionalInterruptions = []) {
    if (toolResults.length === 0 && additionalInterruptions.length === 0) {
        return NOT_FINAL_OUTPUT;
    }
    const interruptions = collectInterruptions(toolResults, additionalInterruptions);
    if (interruptions.length > 0) {
        return {
            isFinalOutput: false,
            isInterrupted: true,
            interruptions,
        };
    }
    if (agent.toolUseBehavior === 'run_llm_again') {
        return NOT_FINAL_OUTPUT;
    }
    const firstToolResult = toolResults[0];
    if (agent.toolUseBehavior === 'stop_on_first_tool') {
        if (firstToolResult?.type === 'function_output') {
            const stringOutput = toSmartString(firstToolResult.output);
            return {
                isFinalOutput: true,
                isInterrupted: undefined,
                finalOutput: stringOutput,
            };
        }
        return NOT_FINAL_OUTPUT;
    }
    const toolUseBehavior = agent.toolUseBehavior;
    if (typeof toolUseBehavior === 'object') {
        const stoppingTool = toolResults.find((r) => {
            return toolUseBehavior.stopAtToolNames.some((toolName) => matchesFunctionToolName(r.tool, toolName));
        });
        if (stoppingTool?.type === 'function_output') {
            const stringOutput = toSmartString(stoppingTool.output);
            return {
                isFinalOutput: true,
                isInterrupted: undefined,
                finalOutput: stringOutput,
            };
        }
        return NOT_FINAL_OUTPUT;
    }
    if (typeof toolUseBehavior === 'function') {
        return toolUseBehavior(state._context, toolResults);
    }
    throw new UserError(`Invalid toolUseBehavior: ${toolUseBehavior}`, state);
}
/**
 * Accepts whatever the tool returned and attempts to coerce it into the structured protocol
 * shapes we expose to downstream model adapters (input_text/input_image/input_file). Tools are
 * allowed to return either a single structured object or an array of them; anything else falls
 * back to the legacy string pipeline.
 */
function normalizeStructuredToolOutputs(output) {
    if (Array.isArray(output)) {
        const structured = [];
        for (const item of output) {
            const normalized = normalizeStructuredToolOutput(item);
            if (!normalized) {
                return null;
            }
            structured.push(normalized);
        }
        return structured;
    }
    const normalized = normalizeStructuredToolOutput(output);
    return normalized ? [normalized] : null;
}
/**
 * Best-effort normalization of a single tool output item. If the object already matches the
 * protocol shape we simply cast it; otherwise we copy the recognised fields into the canonical
 * structure. Returning null lets the caller know we should revert to plain-string handling.
 */
function normalizeStructuredToolOutput(value) {
    if (!isRecord(value)) {
        return null;
    }
    const type = value.type;
    if (type === 'text' && typeof value.text === 'string') {
        const output = { type: 'text', text: value.text };
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    if (type === 'image') {
        const output = { type: 'image' };
        let imageString;
        let imageFileId;
        const fallbackImageMediaType = getImageInlineMediaType(value);
        const imageField = value.image;
        if (typeof imageField === 'string' && imageField.length > 0) {
            imageString = imageField;
        }
        else if (isRecord(imageField)) {
            const imageObj = imageField;
            const inlineMediaType = getImageInlineMediaType(imageObj) ?? fallbackImageMediaType;
            if (isNonEmptyString(imageObj.url)) {
                imageString = imageObj.url;
            }
            else if (isNonEmptyString(imageObj.data)) {
                imageString = toInlineImageString(imageObj.data, inlineMediaType);
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                imageString = toInlineImageString(imageObj.data, inlineMediaType);
            }
            if (!imageString) {
                const candidateId = (isNonEmptyString(imageObj.fileId) && imageObj.fileId) ||
                    (isNonEmptyString(imageObj.id) && imageObj.id) ||
                    undefined;
                if (candidateId) {
                    imageFileId = candidateId;
                }
            }
        }
        if (!imageString &&
            typeof value.imageUrl === 'string' &&
            value.imageUrl.length > 0) {
            imageString = value.imageUrl;
        }
        if (!imageFileId &&
            typeof value.fileId === 'string' &&
            value.fileId.length > 0) {
            imageFileId = value.fileId;
        }
        if (!imageString &&
            typeof value.data === 'string' &&
            value.data.length > 0) {
            imageString = fallbackImageMediaType
                ? toInlineImageString(value.data, fallbackImageMediaType)
                : value.data;
        }
        else if (!imageString &&
            value.data instanceof Uint8Array &&
            value.data.length > 0) {
            imageString = toInlineImageString(value.data, fallbackImageMediaType);
        }
        if (typeof value.detail === 'string' && value.detail.length > 0) {
            output.detail = value.detail;
        }
        if (imageString) {
            output.image = imageString;
        }
        else if (imageFileId) {
            output.image = { fileId: imageFileId };
        }
        else {
            return null;
        }
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    if (type === 'file') {
        const fileValue = normalizeFileValue(value);
        if (!fileValue) {
            return null;
        }
        const output = { type: 'file', file: fileValue };
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    return null;
}
/**
 * Translates the normalized tool output into the protocol `input_*` items. This is the last hop
 * before we hand the data to model-specific adapters, so we generate the exact schema expected by
 * the protocol definitions.
 */
function convertStructuredToolOutputToInputItem(output) {
    if (output.type === 'text') {
        const result = {
            type: 'input_text',
            text: output.text,
        };
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    if (output.type === 'image') {
        const result = { type: 'input_image' };
        if (typeof output.detail === 'string' && output.detail.length > 0) {
            result.detail = output.detail;
        }
        if (typeof output.image === 'string' && output.image.length > 0) {
            result.image = output.image;
        }
        else if (isRecord(output.image)) {
            const imageObj = output.image;
            const inlineMediaType = getImageInlineMediaType(imageObj);
            if (isNonEmptyString(imageObj.url)) {
                result.image = imageObj.url;
            }
            else if (isNonEmptyString(imageObj.data)) {
                result.image =
                    inlineMediaType && !imageObj.data.startsWith('data:')
                        ? asDataUrl(imageObj.data, inlineMediaType)
                        : imageObj.data;
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                const base64 = encodeUint8ArrayToBase64(imageObj.data);
                result.image = asDataUrl(base64, inlineMediaType);
            }
            else {
                const referencedId = (isNonEmptyString(imageObj.fileId) && imageObj.fileId) ||
                    (isNonEmptyString(imageObj.id) && imageObj.id) ||
                    undefined;
                if (referencedId) {
                    result.image = { id: referencedId };
                }
            }
        }
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    if (output.type === 'file') {
        const result = { type: 'input_file' };
        const fileValue = output.file;
        if (typeof fileValue === 'string') {
            result.file = fileValue;
        }
        else if (fileValue && typeof fileValue === 'object') {
            const record = fileValue;
            if ('data' in record && record.data) {
                const mediaType = record.mediaType ?? 'text/plain';
                if (typeof record.data === 'string') {
                    result.file = asDataUrl(record.data, mediaType);
                }
                else {
                    const base64 = encodeUint8ArrayToBase64(record.data);
                    result.file = asDataUrl(base64, mediaType);
                }
            }
            else if (typeof record.url === 'string' && record.url.length > 0) {
                result.file = { url: record.url };
            }
            else {
                const referencedId = (typeof record.id === 'string' &&
                    record.id.length > 0 &&
                    record.id) ||
                    (typeof record.fileId === 'string' && record.fileId.length > 0
                        ? record.fileId
                        : undefined);
                if (referencedId) {
                    result.file = { id: referencedId };
                }
            }
            if (typeof record.filename === 'string' && record.filename.length > 0) {
                result.filename = record.filename;
            }
        }
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    const exhaustiveCheck = output;
    return exhaustiveCheck;
}
function normalizeFileValue(value) {
    const directFile = value.file;
    if (typeof directFile === 'string' && directFile.length > 0) {
        return directFile;
    }
    const normalizedObject = normalizeFileObjectCandidate(directFile);
    if (normalizedObject) {
        return normalizedObject;
    }
    const legacyValue = normalizeLegacyFileValue(value);
    if (legacyValue) {
        return legacyValue;
    }
    return null;
}
function normalizeFileObjectCandidate(value) {
    if (!isRecord(value)) {
        return null;
    }
    if ('data' in value && value.data !== undefined) {
        const dataValue = value.data;
        const hasStringData = typeof dataValue === 'string' && dataValue.length > 0;
        const hasBinaryData = dataValue instanceof Uint8Array && dataValue.length > 0;
        if (!hasStringData && !hasBinaryData) {
            return null;
        }
        if (!isNonEmptyString(value.mediaType) ||
            !isNonEmptyString(value.filename)) {
            return null;
        }
        return {
            data: typeof dataValue === 'string' ? dataValue : new Uint8Array(dataValue),
            mediaType: value.mediaType,
            filename: value.filename,
        };
    }
    if (isNonEmptyString(value.url)) {
        const result = { url: value.url };
        if (isNonEmptyString(value.filename)) {
            result.filename = value.filename;
        }
        return result;
    }
    const referencedId = (isNonEmptyString(value.id) && value.id) ||
        (isNonEmptyString(value.fileId) && value.fileId);
    if (referencedId) {
        const result = { id: referencedId };
        if (isNonEmptyString(value.filename)) {
            result.filename = value.filename;
        }
        return result;
    }
    return null;
}
function normalizeLegacyFileValue(value) {
    const filename = typeof value.filename === 'string' && value.filename.length > 0
        ? value.filename
        : undefined;
    const mediaType = typeof value.mediaType === 'string' && value.mediaType.length > 0
        ? value.mediaType
        : undefined;
    if (typeof value.fileData === 'string' && value.fileData.length > 0) {
        if (!mediaType || !filename) {
            return null;
        }
        return { data: value.fileData, mediaType, filename };
    }
    if (value.fileData instanceof Uint8Array && value.fileData.length > 0) {
        if (!mediaType || !filename) {
            return null;
        }
        return { data: new Uint8Array(value.fileData), mediaType, filename };
    }
    if (typeof value.fileUrl === 'string' && value.fileUrl.length > 0) {
        const result = { url: value.fileUrl };
        if (filename) {
            result.filename = filename;
        }
        return result;
    }
    if (typeof value.fileId === 'string' && value.fileId.length > 0) {
        const result = { id: value.fileId };
        if (filename) {
            result.filename = filename;
        }
        return result;
    }
    return null;
}
function normalizeSafetyChecks(checks) {
    if (!Array.isArray(checks)) {
        return undefined;
    }
    const normalized = [];
    for (const entry of checks) {
        if (!isRecord(entry)) {
            continue;
        }
        const id = entry.id;
        const code = entry.code;
        if (!isNonEmptyString(id) || !isNonEmptyString(code)) {
            continue;
        }
        const message = 'message' in entry && isNonEmptyString(entry.message)
            ? entry.message
            : undefined;
        const normalizedEntry = { ...entry, id, code };
        if (message) {
            normalizedEntry.message = message;
        }
        normalized.push(normalizedEntry);
    }
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeSafetyCheckResult(result) {
    if (!result) {
        return undefined;
    }
    if (!isRecord(result)) {
        return undefined;
    }
    if ('acknowledgedSafetyChecks' in result) {
        return normalizeSafetyChecks(result.acknowledgedSafetyChecks);
    }
    if ('acknowledged_safety_checks' in result) {
        return normalizeSafetyChecks(result.acknowledged_safety_checks);
    }
    return undefined;
}
async function resolveSafetyCheckAcknowledgements(options) {
    const { runContext, toolCall, pendingSafetyChecks, onSafetyCheck } = options;
    if (!onSafetyCheck) {
        return undefined;
    }
    const result = await onSafetyCheck({
        runContext,
        pendingSafetyChecks,
        toolCall,
    });
    if (result === true) {
        return pendingSafetyChecks;
    }
    if (result === false) {
        return undefined;
    }
    return normalizeSafetyCheckResult(result);
}
function getPendingSafetyChecks(toolCall) {
    const providerData = toolCall.providerData;
    if (!isRecord(providerData)) {
        return undefined;
    }
    if ('pending_safety_checks' in providerData) {
        return normalizeSafetyChecks(providerData.pending_safety_checks);
    }
    if ('pendingSafetyChecks' in providerData) {
        return normalizeSafetyChecks(providerData.pendingSafetyChecks);
    }
    return undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
function getImageInlineMediaType(value) {
    if (isNonEmptyString(value.mediaType)) {
        return value.mediaType;
    }
    if (isNonEmptyString(value.mimeType)) {
        return value.mimeType;
    }
    return undefined;
}
function toInlineImageString(data, mediaType) {
    if (typeof data === 'string') {
        if (mediaType && !data.startsWith('data:')) {
            return asDataUrl(data, mediaType);
        }
        return data;
    }
    const base64 = encodeUint8ArrayToBase64(data);
    return asDataUrl(base64, mediaType);
}
function asDataUrl(base64, mediaType) {
    return mediaType ? `data:${mediaType};base64,${base64}` : base64;
}
//# sourceMappingURL=toolExecution.js.map