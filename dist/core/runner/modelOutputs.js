import { ModelBehaviorError } from '../errors';
import { RunHandoffCallItem, RunMessageOutputItem, RunReasoningItem, RunToolApprovalItem, RunToolCallItem, RunToolCallOutputItem, RunToolSearchCallItem, RunToolSearchOutputItem, } from '../items';
import { getClientToolSearchExecutor, getToolSearchRuntimeToolKey, } from '../tool';
import { addErrorToCurrentSpan } from '../tracing/context';
import { getFunctionToolQualifiedName, getFunctionToolNamespace, getToolCallNamespace, resolveFunctionToolCallName, } from '../toolIdentity';
import { getToolSearchMatchKey, getToolSearchExecution, getToolSearchOutputReplacementKey, getToolSearchProviderCallId, } from '../utils';
import { addHostedMcpToolsFromToolSearchOutput, addLoadedToolNamesFromToolSearchOutput, createBuiltInClientToolSearchOutput, executeCustomClientToolSearch, getClientToolSearchHelper, } from './toolSearch';
function ensureToolAvailable(tool, message, data) {
    if (!tool) {
        addErrorToCurrentSpan({
            message,
            data,
        });
        throw new ModelBehaviorError(message);
    }
    return tool;
}
function handleToolCallAction({ output, tool, agent, errorMessage, errorData, items, toolsUsed, actions, buildAction, }) {
    const resolvedTool = ensureToolAvailable(tool, errorMessage, errorData);
    items.push(new RunToolCallItem(output, agent));
    toolsUsed.push(resolvedTool.name);
    actions.push(buildAction(resolvedTool));
}
function recordHandoffRequest(output, handoff, agent, items, toolsUsed, handoffs) {
    toolsUsed.push(output.name);
    const isPrimaryHandoff = handoffs.length === 0;
    handoffs.push({
        toolCall: output,
        handoff,
    });
    if (!isPrimaryHandoff) {
        return;
    }
    // Only persist the first handoff request. Later handoffs are SDK-ignored and
    // would otherwise bias future turns against valid delegation targets.
    items.push(new RunHandoffCallItem(output, agent));
}
function resolveFunctionOrHandoff(toolCall, handoffMap, functionMap, agent) {
    const resolvedToolName = resolveFunctionToolCallName(toolCall, functionMap) ?? toolCall.name;
    const namespace = getToolCallNamespace(toolCall);
    if (!namespace && typeof resolvedToolName === 'string') {
        const functionTool = functionMap.get(resolvedToolName);
        const handoff = handoffMap.get(toolCall.name);
        if (functionTool && handoff && resolvedToolName.includes('.')) {
            const message = `Ambiguous dotted tool call ${resolvedToolName} in agent ${agent.name}: it matches both a namespaced function tool and a handoff. Rename one of them or emit the function call with explicit namespace metadata.`;
            addErrorToCurrentSpan({
                message,
                data: {
                    tool_name: resolvedToolName,
                    agent_name: agent.name,
                },
            });
            throw new ModelBehaviorError(message);
        }
        if (functionTool && resolvedToolName.includes('.')) {
            return { type: 'function', tool: functionTool };
        }
        if (handoff) {
            return { type: 'handoff', handoff };
        }
    }
    const functionTool = functionMap.get(resolvedToolName);
    if (!functionTool) {
        const message = `Tool ${resolvedToolName} not found in agent ${agent.name}.`;
        addErrorToCurrentSpan({
            message,
            data: {
                tool_name: resolvedToolName,
                agent_name: agent.name,
            },
        });
        throw new ModelBehaviorError(message);
    }
    return { type: 'function', tool: functionTool };
}
function normalizeFunctionToolCallForStorage(toolCall, tool) {
    const namespace = getToolCallNamespace(toolCall);
    const explicitNamespace = getFunctionToolNamespace(tool);
    const qualifiedToolName = getFunctionToolQualifiedName(tool);
    if (namespace ||
        !explicitNamespace ||
        !qualifiedToolName ||
        toolCall.name !== qualifiedToolName) {
        return toolCall;
    }
    return {
        ...toolCall,
        name: tool.name,
        namespace: explicitNamespace,
    };
}
function getRawAgentInputItem(item) {
    if (item &&
        typeof item === 'object' &&
        'rawItem' in item &&
        item.rawItem &&
        typeof item.rawItem === 'object') {
        return item.rawItem;
    }
    return item;
}
function refreshLoadedDeferredToolNames(state) {
    state.loadedToolNames.clear();
    for (const toolSearchOutput of state.keyedToolSearchOutputsByKey.values()) {
        addLoadedToolNamesFromToolSearchOutput(toolSearchOutput, state.loadedToolNames);
    }
    for (const toolSearchOutput of state.anonymousToolSearchOutputs) {
        addLoadedToolNamesFromToolSearchOutput(toolSearchOutput, state.loadedToolNames);
    }
}
function recordLoadedToolSearchOutput(state, toolSearchOutput) {
    const replacementKey = getToolSearchOutputReplacementKey(toolSearchOutput);
    if (replacementKey) {
        state.keyedToolSearchOutputsByKey.set(replacementKey, toolSearchOutput);
    }
    else {
        state.anonymousToolSearchOutputs.push(toolSearchOutput);
    }
    refreshLoadedDeferredToolNames(state);
}
function collectLoadedDeferredToolStateFromHistory(items, agent) {
    const state = {
        anonymousToolSearchOutputs: [],
        keyedToolSearchOutputsByKey: new Map(),
        loadedToolNames: new Set(),
    };
    for (const item of items) {
        if (item instanceof RunToolSearchOutputItem &&
            item.agent.name !== agent.name) {
            continue;
        }
        const rawItem = getRawAgentInputItem(item);
        if (rawItem?.type !== 'tool_search_output') {
            continue;
        }
        const replacementKey = getToolSearchOutputReplacementKey(rawItem);
        if (replacementKey) {
            state.keyedToolSearchOutputsByKey.set(replacementKey, rawItem);
        }
        else {
            state.anonymousToolSearchOutputs.push(rawItem);
        }
    }
    refreshLoadedDeferredToolNames(state);
    return state;
}
function seedHostedMcpToolsFromLoadedDeferredToolState(state, mcpToolMap, preserveExistingServerLabels) {
    for (const toolSearchOutput of state.keyedToolSearchOutputsByKey.values()) {
        addHostedMcpToolsFromToolSearchOutput(toolSearchOutput, mcpToolMap, {
            preserveExistingServerLabels,
        });
    }
    for (const toolSearchOutput of state.anonymousToolSearchOutputs) {
        addHostedMcpToolsFromToolSearchOutput(toolSearchOutput, mcpToolMap, {
            preserveExistingServerLabels,
        });
    }
}
function buildFunctionToolMap(tools) {
    return new Map(tools
        .filter((t) => t.type === 'function')
        .map((t) => [getFunctionToolQualifiedName(t) ?? t.name, t]));
}
function registerRuntimeToolSearchTools(args) {
    const { availableTools, functionMap, mcpToolMap, replaceableRuntimeToolKeys, runtimeTools, } = args;
    const availableToolsByKey = new Map();
    for (const tool of availableTools) {
        const key = getToolSearchRuntimeToolKey(tool);
        if (key) {
            availableToolsByKey.set(key, tool);
        }
    }
    const novelTools = [];
    for (const runtimeTool of runtimeTools) {
        const runtimeToolKey = getToolSearchRuntimeToolKey(runtimeTool);
        if (!runtimeToolKey) {
            throw new ModelBehaviorError('Client tool_search execute() returned an unsupported tool type.');
        }
        const existingTool = availableToolsByKey.get(runtimeToolKey);
        if (existingTool && existingTool !== runtimeTool) {
            if (!replaceableRuntimeToolKeys?.has(runtimeToolKey)) {
                throw new ModelBehaviorError(`Client tool_search execute() returned tool "${runtimeToolKey}" that conflicts with an existing available tool.`);
            }
        }
        else if (existingTool === runtimeTool) {
            continue;
        }
        availableToolsByKey.set(runtimeToolKey, runtimeTool);
        novelTools.push(runtimeTool);
        if (runtimeTool.type === 'function') {
            functionMap.set(getFunctionToolQualifiedName(runtimeTool) ?? runtimeTool.name, runtimeTool);
            continue;
        }
        if (runtimeTool.type === 'hosted_tool' &&
            runtimeTool.providerData?.type === 'mcp') {
            mcpToolMap.set(runtimeTool.providerData.server_label, runtimeTool);
            continue;
        }
        throw new ModelBehaviorError('Client tool_search execute() returned an unsupported tool type.');
    }
    return novelTools;
}
function buildGeneratedClientToolSearchOutputMap(modelResponse, tools, hasClientToolSearchTool) {
    const clientToolSearchCalls = [];
    const pendingClientToolSearchMatchKeys = [];
    const resolvedToolSearchCallIds = new Set();
    for (const output of modelResponse.output) {
        if (output.type === 'tool_search_call') {
            const toolSearchExecution = getToolSearchExecution(output);
            if (toolSearchExecution === 'client' ||
                (typeof toolSearchExecution === 'undefined' && hasClientToolSearchTool)) {
                clientToolSearchCalls.push(output);
                const matchKey = getToolSearchMatchKey(output);
                if (matchKey) {
                    pendingClientToolSearchMatchKeys.push(matchKey);
                }
            }
            continue;
        }
        if (output.type !== 'tool_search_output') {
            continue;
        }
        const explicitCallId = getToolSearchProviderCallId(output);
        const toolSearchExecution = getToolSearchExecution(output);
        if (explicitCallId) {
            resolvedToolSearchCallIds.add(explicitCallId);
            const pendingIndex = pendingClientToolSearchMatchKeys.indexOf(explicitCallId);
            if (pendingIndex >= 0) {
                pendingClientToolSearchMatchKeys.splice(pendingIndex, 1);
            }
            continue;
        }
        if (toolSearchExecution !== 'server') {
            const pendingMatchKey = pendingClientToolSearchMatchKeys.shift();
            if (pendingMatchKey) {
                resolvedToolSearchCallIds.add(pendingMatchKey);
            }
        }
    }
    const generatedOutputs = new Map();
    for (const toolSearchCall of clientToolSearchCalls) {
        const matchKey = getToolSearchMatchKey(toolSearchCall);
        if (matchKey && resolvedToolSearchCallIds.has(matchKey)) {
            continue;
        }
        generatedOutputs.set(toolSearchCall, createBuiltInClientToolSearchOutput(toolSearchCall, tools));
    }
    return generatedOutputs;
}
async function buildGeneratedClientToolSearchOutputMapAsync(args) {
    const { agent, modelResponse, runContext, tools } = args;
    const clientToolSearchTool = getClientToolSearchHelper(tools);
    const hasClientToolSearchTool = typeof clientToolSearchTool !== 'undefined';
    const executionTools = [...tools];
    const clientToolSearchCalls = [];
    const pendingClientToolSearchMatchKeys = [];
    const resolvedToolSearchCallIds = new Set();
    for (const output of modelResponse.output) {
        if (output.type === 'tool_search_call') {
            const toolSearchExecution = getToolSearchExecution(output);
            if (toolSearchExecution === 'client' ||
                (typeof toolSearchExecution === 'undefined' && hasClientToolSearchTool)) {
                clientToolSearchCalls.push(output);
                const matchKey = getToolSearchMatchKey(output);
                if (matchKey) {
                    pendingClientToolSearchMatchKeys.push(matchKey);
                }
            }
            continue;
        }
        if (output.type !== 'tool_search_output') {
            continue;
        }
        const explicitCallId = getToolSearchProviderCallId(output);
        const toolSearchExecution = getToolSearchExecution(output);
        if (explicitCallId) {
            resolvedToolSearchCallIds.add(explicitCallId);
            const pendingIndex = pendingClientToolSearchMatchKeys.indexOf(explicitCallId);
            if (pendingIndex >= 0) {
                pendingClientToolSearchMatchKeys.splice(pendingIndex, 1);
            }
            continue;
        }
        if (toolSearchExecution !== 'server') {
            const pendingMatchKey = pendingClientToolSearchMatchKeys.shift();
            if (pendingMatchKey) {
                resolvedToolSearchCallIds.add(pendingMatchKey);
            }
        }
    }
    const generatedOutputs = new Map();
    for (const toolSearchCall of clientToolSearchCalls) {
        const matchKey = getToolSearchMatchKey(toolSearchCall);
        if (matchKey && resolvedToolSearchCallIds.has(matchKey)) {
            continue;
        }
        if (clientToolSearchTool &&
            getClientToolSearchExecutor(clientToolSearchTool)) {
            const generatedOutput = await executeCustomClientToolSearch({
                agent,
                runContext,
                toolSearchCall,
                toolSearchTool: clientToolSearchTool,
                tools: executionTools,
            });
            generatedOutputs.set(toolSearchCall, generatedOutput);
            executionTools.push(...generatedOutput.runtimeTools);
            continue;
        }
        generatedOutputs.set(toolSearchCall, {
            output: createBuiltInClientToolSearchOutput(toolSearchCall, executionTools),
            runtimeTools: [],
        });
    }
    return generatedOutputs;
}
function ensureDeferredFunctionToolLoaded(toolCall, tool, loadedToolNames, agent) {
    if (tool.deferLoading !== true) {
        return;
    }
    const explicitNamespace = getFunctionToolNamespace(tool);
    const qualifiedName = getFunctionToolQualifiedName(tool);
    const isLoaded = (qualifiedName ? loadedToolNames.has(qualifiedName) : false) ||
        ((!explicitNamespace || explicitNamespace === tool.name) &&
            loadedToolNames.has(tool.name));
    if (isLoaded) {
        return;
    }
    const toolName = qualifiedName ?? tool.name;
    const message = `Model produced deferred function call ${toolName} before it was loaded via tool_search.`;
    addErrorToCurrentSpan({
        message,
        data: {
            agent_name: agent.name,
            tool_name: toolName,
            tool_call_id: toolCall.callId,
        },
    });
    throw new ModelBehaviorError(message);
}
function parseShellCallStatus(status) {
    if (status === 'in_progress' ||
        status === 'completed' ||
        status === 'incomplete') {
        return status;
    }
    return undefined;
}
function isShellCallPendingStatus(status) {
    if (typeof status === 'undefined') {
        return true;
    }
    return parseShellCallStatus(status) === 'in_progress';
}
function hasPendingShellOutputStatus(output) {
    const outputStatus = output.status ?? output.providerData?.status;
    if (typeof outputStatus !== 'string') {
        return false;
    }
    return isShellCallPendingStatus(outputStatus);
}
/**
 * Walks a raw model response and classifies each item so the runner can schedule follow-up work.
 * Returns both the serializable RunItems (for history/streaming) and the actionable tool metadata.
 */
export function processModelResponse(modelResponse, agent, tools, handoffs, priorItems = []) {
    const items = [];
    const runHandoffs = [];
    const runFunctions = [];
    const runComputerActions = [];
    const runShellActions = [];
    let hasHostedShellCall = false;
    const runApplyPatchActions = [];
    const runMCPApprovalRequests = [];
    const toolsUsed = [];
    const handoffMap = new Map(handoffs.map((h) => [h.toolName, h]));
    // Resolve tools upfront so we can look up the concrete handler in O(1) while iterating outputs.
    const functionMap = new Map(tools
        .filter((t) => t.type === 'function')
        .map((t) => [getFunctionToolQualifiedName(t) ?? t.name, t]));
    const computerTool = tools.find((t) => t.type === 'computer');
    const shellTool = tools.find((t) => t.type === 'shell');
    const applyPatchTool = tools.find((t) => t.type === 'apply_patch');
    const mcpToolMap = new Map(tools
        .filter((t) => t.type === 'hosted_tool' && t.providerData?.type === 'mcp')
        .map((t) => t)
        .map((t) => [t.providerData.server_label, t]));
    const originalMcpServerLabels = new Set(mcpToolMap.keys());
    const hasClientToolSearchTool = tools.some((tool) => tool.type === 'hosted_tool' &&
        tool.providerData?.type === 'tool_search' &&
        tool.providerData.execution === 'client');
    const loadedDeferredToolState = collectLoadedDeferredToolStateFromHistory(priorItems, agent);
    seedHostedMcpToolsFromLoadedDeferredToolState(loadedDeferredToolState, mcpToolMap, originalMcpServerLabels);
    const generatedClientToolSearchOutputsByCall = buildGeneratedClientToolSearchOutputMap(modelResponse, tools, hasClientToolSearchTool);
    let hasGeneratedClientToolSearchOutputs = false;
    for (const output of modelResponse.output) {
        if (output.type === 'message') {
            if (output.role === 'assistant') {
                items.push(new RunMessageOutputItem(output, agent));
            }
        }
        else if (output.type === 'tool_search_call') {
            items.push(new RunToolSearchCallItem(output, agent));
            toolsUsed.push('tool_search');
            const generatedOutput = generatedClientToolSearchOutputsByCall.get(output);
            if (generatedOutput) {
                items.push(new RunToolSearchOutputItem(generatedOutput, agent));
                recordLoadedToolSearchOutput(loadedDeferredToolState, generatedOutput);
                addHostedMcpToolsFromToolSearchOutput(generatedOutput, mcpToolMap, {
                    preserveExistingServerLabels: originalMcpServerLabels,
                });
                hasGeneratedClientToolSearchOutputs = true;
            }
        }
        else if (output.type === 'tool_search_output') {
            items.push(new RunToolSearchOutputItem(output, agent));
            recordLoadedToolSearchOutput(loadedDeferredToolState, output);
            addHostedMcpToolsFromToolSearchOutput(output, mcpToolMap, {
                preserveExistingServerLabels: originalMcpServerLabels,
            });
        }
        else if (output.type === 'hosted_tool_call') {
            items.push(new RunToolCallItem(output, agent));
            const toolName = output.name;
            toolsUsed.push(toolName);
            if (output.providerData?.type === 'mcp_approval_request' ||
                output.name === 'mcp_approval_request') {
                // Hosted remote MCP server's approval process
                const providerData = output.providerData;
                const mcpServerLabel = providerData.server_label;
                const mcpServerTool = mcpToolMap.get(mcpServerLabel);
                if (typeof mcpServerTool === 'undefined') {
                    const message = `MCP server (${mcpServerLabel}) not found in Agent (${agent.name})`;
                    addErrorToCurrentSpan({
                        message,
                        data: { mcp_server_label: mcpServerLabel },
                    });
                    throw new ModelBehaviorError(message);
                }
                // Do this approval later:
                // We support both onApproval callback (like the Python SDK does) and HITL patterns.
                const approvalItem = new RunToolApprovalItem({
                    type: 'hosted_tool_call',
                    // We must use this name to align with the name sent from the servers
                    name: providerData.name,
                    id: providerData.id,
                    status: 'in_progress',
                    providerData,
                }, agent);
                runMCPApprovalRequests.push({
                    requestItem: approvalItem,
                    mcpTool: mcpServerTool,
                });
                if (!mcpServerTool.providerData.on_approval) {
                    // When onApproval function exists, it confirms the approval right after this.
                    // Thus, this approval item must be appended only for the next turn interruption patterns.
                    items.push(approvalItem);
                }
            }
        }
        else if (output.type === 'reasoning') {
            items.push(new RunReasoningItem(output, agent));
        }
        else if (output.type === 'computer_call') {
            handleToolCallAction({
                output,
                tool: computerTool,
                agent,
                errorMessage: 'Model produced computer action without a computer tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runComputerActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    computer: resolvedTool,
                }),
            });
        }
        else if (output.type === 'shell_call') {
            const resolvedShellTool = ensureToolAvailable(shellTool, 'Model produced shell action without a shell tool.', { agent_name: agent.name });
            items.push(new RunToolCallItem(output, agent));
            toolsUsed.push(resolvedShellTool.name);
            const shellEnvironmentType = resolvedShellTool.environment?.type ?? 'local';
            // Hosted container shell is executed by the API provider, so no local action is queued.
            if (shellEnvironmentType !== 'local') {
                if (isShellCallPendingStatus(output.status)) {
                    hasHostedShellCall = true;
                }
                continue;
            }
            if (!resolvedShellTool.shell) {
                const message = 'Model produced local shell action without a local shell implementation.';
                addErrorToCurrentSpan({
                    message,
                    data: { agent_name: agent.name },
                });
                throw new ModelBehaviorError(message);
            }
            runShellActions.push({
                toolCall: output,
                shell: resolvedShellTool,
            });
        }
        else if (output.type === 'shell_call_output') {
            items.push(new RunToolCallOutputItem(output, agent, output.output));
            if (hasPendingShellOutputStatus(output)) {
                hasHostedShellCall = true;
            }
        }
        else if (output.type === 'apply_patch_call') {
            handleToolCallAction({
                output,
                tool: applyPatchTool,
                agent,
                errorMessage: 'Model produced apply_patch action without an apply_patch tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runApplyPatchActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    applyPatch: resolvedTool,
                }),
            });
        }
        /*
         * Intentionally skip returning here so function_call processing can still
         * run when output.type matches other tool call types.
         */
        if (output.type !== 'function_call') {
            continue;
        }
        const resolved = resolveFunctionOrHandoff(output, handoffMap, functionMap, agent);
        if (resolved.type === 'handoff') {
            recordHandoffRequest(output, resolved.handoff, agent, items, toolsUsed, runHandoffs);
        }
        else {
            ensureDeferredFunctionToolLoaded(output, resolved.tool, loadedDeferredToolState.loadedToolNames, agent);
            const normalizedToolCall = normalizeFunctionToolCallForStorage(output, resolved.tool);
            toolsUsed.push(getFunctionToolQualifiedName(resolved.tool) ?? resolved.tool.name);
            items.push(new RunToolCallItem(normalizedToolCall, agent));
            runFunctions.push({
                toolCall: normalizedToolCall,
                tool: resolved.tool,
            });
        }
    }
    return {
        newItems: items,
        handoffs: runHandoffs,
        functions: runFunctions,
        computerActions: runComputerActions,
        shellActions: runShellActions,
        applyPatchActions: runApplyPatchActions,
        mcpApprovalRequests: runMCPApprovalRequests,
        toolsUsed: toolsUsed,
        hasToolsOrApprovalsToRun() {
            return (runHandoffs.length > 0 ||
                runFunctions.length > 0 ||
                runMCPApprovalRequests.length > 0 ||
                runComputerActions.length > 0 ||
                runShellActions.length > 0 ||
                hasHostedShellCall ||
                runApplyPatchActions.length > 0 ||
                hasGeneratedClientToolSearchOutputs);
        },
    };
}
export async function processModelResponseAsync(modelResponse, agent, tools, handoffs, state, priorItems = []) {
    const clientToolSearchTool = getClientToolSearchHelper(tools);
    const hasCustomClientToolSearchExecutor = Boolean(clientToolSearchTool && getClientToolSearchExecutor(clientToolSearchTool));
    const hasRelevantClientToolSearchCall = modelResponse.output.some((output) => output.type === 'tool_search_call' &&
        (getToolSearchExecution(output) === 'client' ||
            (typeof getToolSearchExecution(output) === 'undefined' &&
                typeof clientToolSearchTool !== 'undefined')));
    if (!hasCustomClientToolSearchExecutor || !hasRelevantClientToolSearchCall) {
        return processModelResponse(modelResponse, agent, tools, handoffs, priorItems);
    }
    const items = [];
    const runHandoffs = [];
    const runFunctions = [];
    const runComputerActions = [];
    const runShellActions = [];
    let hasHostedShellCall = false;
    const runApplyPatchActions = [];
    const runMCPApprovalRequests = [];
    const toolsUsed = [];
    const handoffMap = new Map(handoffs.map((h) => [h.toolName, h]));
    const functionMap = buildFunctionToolMap(tools);
    const computerTool = tools.find((t) => t.type === 'computer');
    const shellTool = tools.find((t) => t.type === 'shell');
    const applyPatchTool = tools.find((t) => t.type === 'apply_patch');
    const mcpToolMap = new Map(tools
        .filter((t) => t.type === 'hosted_tool' && t.providerData?.type === 'mcp')
        .map((t) => t)
        .map((t) => [t.providerData.server_label, t]));
    const originalMcpServerLabels = new Set(mcpToolMap.keys());
    const replaceableRuntimeToolKeys = new Set(state
        .getToolSearchRuntimeTools(agent)
        .map((tool) => getToolSearchRuntimeToolKey(tool))
        .filter((key) => typeof key === 'string'));
    const loadedDeferredToolState = collectLoadedDeferredToolStateFromHistory(priorItems, agent);
    seedHostedMcpToolsFromLoadedDeferredToolState(loadedDeferredToolState, mcpToolMap, originalMcpServerLabels);
    const generatedClientToolSearchOutputsByCall = await buildGeneratedClientToolSearchOutputMapAsync({
        agent,
        modelResponse,
        runContext: state._context,
        tools,
    });
    let hasGeneratedClientToolSearchOutputs = false;
    const availableTools = [...tools];
    for (const output of modelResponse.output) {
        if (output.type === 'message') {
            if (output.role === 'assistant') {
                items.push(new RunMessageOutputItem(output, agent));
            }
        }
        else if (output.type === 'tool_search_call') {
            items.push(new RunToolSearchCallItem(output, agent));
            toolsUsed.push('tool_search');
            const generatedOutput = generatedClientToolSearchOutputsByCall.get(output);
            if (generatedOutput) {
                items.push(new RunToolSearchOutputItem(generatedOutput.output, agent));
                recordLoadedToolSearchOutput(loadedDeferredToolState, generatedOutput.output);
                addHostedMcpToolsFromToolSearchOutput(generatedOutput.output, mcpToolMap, {
                    preserveExistingServerLabels: originalMcpServerLabels,
                });
                const novelRuntimeTools = registerRuntimeToolSearchTools({
                    availableTools,
                    functionMap,
                    mcpToolMap,
                    replaceableRuntimeToolKeys,
                    runtimeTools: generatedOutput.runtimeTools,
                });
                state.recordToolSearchRuntimeTools(agent, generatedOutput.output, novelRuntimeTools);
                hasGeneratedClientToolSearchOutputs = true;
            }
        }
        else if (output.type === 'tool_search_output') {
            items.push(new RunToolSearchOutputItem(output, agent));
            recordLoadedToolSearchOutput(loadedDeferredToolState, output);
            addHostedMcpToolsFromToolSearchOutput(output, mcpToolMap, {
                preserveExistingServerLabels: originalMcpServerLabels,
            });
        }
        else if (output.type === 'hosted_tool_call') {
            items.push(new RunToolCallItem(output, agent));
            const toolName = output.name;
            toolsUsed.push(toolName);
            if (output.providerData?.type === 'mcp_approval_request' ||
                output.name === 'mcp_approval_request') {
                const providerData = output.providerData;
                const mcpServerLabel = providerData.server_label;
                const mcpServerTool = mcpToolMap.get(mcpServerLabel);
                if (typeof mcpServerTool === 'undefined') {
                    const message = `MCP server (${mcpServerLabel}) not found in Agent (${agent.name})`;
                    addErrorToCurrentSpan({
                        message,
                        data: { mcp_server_label: mcpServerLabel },
                    });
                    throw new ModelBehaviorError(message);
                }
                const approvalItem = new RunToolApprovalItem({
                    type: 'hosted_tool_call',
                    name: providerData.name,
                    id: providerData.id,
                    status: 'in_progress',
                    providerData,
                }, agent);
                runMCPApprovalRequests.push({
                    requestItem: approvalItem,
                    mcpTool: mcpServerTool,
                });
                if (!mcpServerTool.providerData.on_approval) {
                    items.push(approvalItem);
                }
            }
        }
        else if (output.type === 'reasoning') {
            items.push(new RunReasoningItem(output, agent));
        }
        else if (output.type === 'computer_call') {
            handleToolCallAction({
                output,
                tool: computerTool,
                agent,
                errorMessage: 'Model produced computer action without a computer tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runComputerActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    computer: resolvedTool,
                }),
            });
        }
        else if (output.type === 'shell_call') {
            const resolvedShellTool = ensureToolAvailable(shellTool, 'Model produced shell action without a shell tool.', { agent_name: agent.name });
            items.push(new RunToolCallItem(output, agent));
            toolsUsed.push(resolvedShellTool.name);
            const shellEnvironmentType = resolvedShellTool.environment?.type ?? 'local';
            if (shellEnvironmentType !== 'local') {
                if (isShellCallPendingStatus(output.status)) {
                    hasHostedShellCall = true;
                }
                continue;
            }
            if (!resolvedShellTool.shell) {
                const message = 'Model produced local shell action without a local shell implementation.';
                addErrorToCurrentSpan({
                    message,
                    data: { agent_name: agent.name },
                });
                throw new ModelBehaviorError(message);
            }
            runShellActions.push({
                toolCall: output,
                shell: resolvedShellTool,
            });
        }
        else if (output.type === 'shell_call_output') {
            items.push(new RunToolCallOutputItem(output, agent, output.output));
            if (hasPendingShellOutputStatus(output)) {
                hasHostedShellCall = true;
            }
        }
        else if (output.type === 'apply_patch_call') {
            handleToolCallAction({
                output,
                tool: applyPatchTool,
                agent,
                errorMessage: 'Model produced apply_patch action without an apply_patch tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runApplyPatchActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    applyPatch: resolvedTool,
                }),
            });
        }
        if (output.type !== 'function_call') {
            continue;
        }
        const resolved = resolveFunctionOrHandoff(output, handoffMap, functionMap, agent);
        if (resolved.type === 'handoff') {
            recordHandoffRequest(output, resolved.handoff, agent, items, toolsUsed, runHandoffs);
        }
        else {
            ensureDeferredFunctionToolLoaded(output, resolved.tool, loadedDeferredToolState.loadedToolNames, agent);
            const normalizedToolCall = normalizeFunctionToolCallForStorage(output, resolved.tool);
            toolsUsed.push(getFunctionToolQualifiedName(resolved.tool) ?? resolved.tool.name);
            items.push(new RunToolCallItem(normalizedToolCall, agent));
            runFunctions.push({
                toolCall: normalizedToolCall,
                tool: resolved.tool,
            });
        }
    }
    return {
        newItems: items,
        handoffs: runHandoffs,
        functions: runFunctions,
        computerActions: runComputerActions,
        shellActions: runShellActions,
        applyPatchActions: runApplyPatchActions,
        mcpApprovalRequests: runMCPApprovalRequests,
        toolsUsed,
        hasToolsOrApprovalsToRun() {
            return (runHandoffs.length > 0 ||
                runFunctions.length > 0 ||
                runMCPApprovalRequests.length > 0 ||
                runComputerActions.length > 0 ||
                runShellActions.length > 0 ||
                hasHostedShellCall ||
                runApplyPatchActions.length > 0 ||
                hasGeneratedClientToolSearchOutputs);
        },
    };
}
//# sourceMappingURL=modelOutputs.js.map