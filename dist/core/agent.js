import { AgentHooks } from './lifecycle';
import { getAllMcpTools } from './mcp';
import { getDefaultModelSettings, gpt5ReasoningSettingsRequired, isGpt5Default, } from './defaultModel';
import { RunContext } from './runContext';
import { tool, } from './tool';
import { getHandoff } from './handoff';
import { Runner } from './run';
import { RunState } from './runState';
import { toFunctionToolName } from './utils/tools';
import { getOutputText } from './utils/messages';
import { isZodObject } from './utils/typeGuards';
import { combineAbortSignals } from './utils/abortSignals';
import { ModelBehaviorError, UserError } from './errors';
import logger from './logger';
import { AgentAsToolInputSchema, buildStructuredInputSchemaInfo, resolveAgentToolInput, } from './agentToolInput';
import { getAgentToolParentRunConfigFromDetails, getInheritedAgentToolRunConfig, mergeAgentToolRunConfig, } from './agentToolRunConfig';
import { saveAgentToolRunResult } from './agentToolRunResults';
import { registerAgentToolSourceAgent } from './agentToolSourceRegistry';
/**
 * The class representing an AI agent configured with instructions, tools, guardrails, handoffs and more.
 *
 * We strongly recommend passing `instructions`, which is the "system prompt" for the agent. In
 * addition, you can pass `handoffDescription`, which is a human-readable description of the
 * agent, used when the agent is used inside tools/handoffs.
 *
 * Agents are generic on the context type. The context is a (mutable) object you create. It is
 * passed to tool functions, handoffs, guardrails, etc.
 */
export class Agent extends AgentHooks {
    /**
     * Create an Agent with handoffs and automatically infer the union type for TOutput from the handoff agents' output types.
     */
    static create(config) {
        return new Agent({
            ...config,
            handoffs: config.handoffs,
            outputType: config.outputType,
            handoffOutputTypeWarningEnabled: false,
        });
    }
    static DEFAULT_MODEL_PLACEHOLDER = '';
    name;
    instructions;
    prompt;
    handoffDescription;
    handoffs;
    model;
    modelSettings;
    tools;
    mcpServers;
    inputGuardrails;
    outputGuardrails;
    outputType = 'text';
    toolUseBehavior;
    resetToolChoice;
    _toolsExplicitlyConfigured;
    constructor(config) {
        super();
        if (typeof config.name !== 'string' || config.name.trim() === '') {
            throw new UserError('Agent must have a name.');
        }
        this.name = config.name;
        this.instructions = config.instructions ?? Agent.DEFAULT_MODEL_PLACEHOLDER;
        this.prompt = config.prompt;
        this.handoffDescription = config.handoffDescription ?? '';
        this.handoffs = config.handoffs ?? [];
        this.model = config.model ?? '';
        this.modelSettings = config.modelSettings ?? getDefaultModelSettings();
        this.tools = config.tools ?? [];
        this._toolsExplicitlyConfigured = config.tools !== undefined;
        this.mcpServers = config.mcpServers ?? [];
        this.inputGuardrails = config.inputGuardrails ?? [];
        this.outputGuardrails = config.outputGuardrails ?? [];
        if (config.outputType) {
            this.outputType = config.outputType;
        }
        this.toolUseBehavior = config.toolUseBehavior ?? 'run_llm_again';
        this.resetToolChoice = config.resetToolChoice ?? true;
        if (
        // The user sets a non-default model
        config.model !== undefined &&
            // The default model is gpt-5
            isGpt5Default() &&
            // However, the specified model is not a gpt-5 model
            (typeof config.model !== 'string' ||
                !gpt5ReasoningSettingsRequired(config.model)) &&
            // The model settings are not customized for the specified model
            config.modelSettings === undefined) {
            // In this scenario, we should use a generic model settings
            // because non-gpt-5 models are not compatible with the default gpt-5 model settings.
            // This is a best-effort attempt to make the agent work with non-gpt-5 models.
            this.modelSettings = {};
        }
        // --- Runtime warning for handoff output type compatibility ---
        if (config.handoffOutputTypeWarningEnabled === undefined ||
            config.handoffOutputTypeWarningEnabled) {
            if (this.handoffs && this.outputType) {
                const outputTypes = new Set([JSON.stringify(this.outputType)]);
                for (const h of this.handoffs) {
                    if ('outputType' in h && h.outputType) {
                        outputTypes.add(JSON.stringify(h.outputType));
                    }
                    else if ('agent' in h && h.agent.outputType) {
                        outputTypes.add(JSON.stringify(h.agent.outputType));
                    }
                }
                if (outputTypes.size > 1) {
                    logger.warn(`[Agent] Warning: Handoff agents have different output types: ${Array.from(outputTypes).join(', ')}. You can make it type-safe by using Agent.create({ ... }) method instead.`);
                }
            }
        }
    }
    /**
     * Output schema name.
     */
    get outputSchemaName() {
        if (this.outputType === 'text') {
            return 'text';
        }
        else if (isZodObject(this.outputType)) {
            return 'ZodOutput';
        }
        else if (typeof this.outputType === 'object') {
            return this.outputType.name;
        }
        throw new Error(`Unknown output type: ${this.outputType}`);
    }
    /**
     * Makes a copy of the agent, with the given arguments changed. For example, you could do:
     *
     * ```
     * const newAgent = agent.clone({ instructions: 'New instructions' })
     * ```
     *
     * @param config - A partial configuration to change.
     * @returns A new agent with the given changes.
     */
    clone(config) {
        return new Agent({
            ...this,
            ...config,
        });
    }
    asTool(options) {
        const { toolName, toolDescription, customOutputExtractor, needsApproval, parameters, inputBuilder, includeInputSchema, runConfig, runOptions, resumeState, isEnabled, onStream, } = options;
        // Event handlers are scoped to this agent tool instance and are not shared; we only support registration (no removal) to keep the API surface small.
        const eventHandlers = new Map();
        const emitEvent = async (event) => {
            // We intentionally keep only add semantics (no off) to reduce surface area; handlers are scoped to this agent tool instance.
            const specific = eventHandlers.get(event.event.type);
            const wildcard = eventHandlers.get('*');
            const candidates = [
                ...(onStream ? [onStream] : []),
                ...(specific ? Array.from(specific) : []),
                ...(wildcard ? Array.from(wildcard) : []),
            ];
            // Run all handlers in parallel so a slow onStream callback does not block on(...) handlers (and vice versa).
            await Promise.allSettled(candidates.map((handler) => Promise.resolve().then(() => handler(event))));
        };
        const resolvedToolName = toolName ?? toFunctionToolName(this.name);
        const toolParameters = (parameters ??
            AgentAsToolInputSchema);
        const hasCustomParameters = typeof parameters !== 'undefined';
        const includeSchema = includeInputSchema === true && hasCustomParameters;
        const shouldCaptureToolInput = hasCustomParameters ||
            includeSchema ||
            typeof inputBuilder === 'function';
        const schemaInfo = shouldCaptureToolInput
            ? buildStructuredInputSchemaInfo(toolParameters, resolvedToolName, includeSchema)
            : undefined;
        const baseTool = tool({
            name: resolvedToolName,
            description: toolDescription ?? '',
            parameters: toolParameters,
            strict: true,
            needsApproval: needsApproval,
            isEnabled,
            execute: async (params, context, details) => {
                const typedParams = params;
                const runContextBase = runOptions?.context instanceof RunContext
                    ? runOptions.context
                    : typeof runOptions?.context !== 'undefined'
                        ? new RunContext(runOptions.context)
                        : context instanceof RunContext
                            ? context
                            : typeof context !== 'undefined'
                                ? new RunContext(context)
                                : new RunContext();
                const agentToolInvocation = {
                    toolName: details?.toolCall?.name ?? baseTool.name,
                    toolCallId: details?.toolCall?.callId,
                    toolArguments: details?.toolCall?.arguments,
                };
                const shouldClearToolInput = !shouldCaptureToolInput &&
                    typeof runContextBase.toolInput !== 'undefined';
                const runContext = shouldCaptureToolInput &&
                    typeof runContextBase._forkWithToolInput === 'function'
                    ? runContextBase._forkWithToolInput(typedParams)
                    : shouldClearToolInput &&
                        typeof runContextBase._forkWithoutToolInput === 'function'
                        ? runContextBase._forkWithoutToolInput()
                        : runContextBase;
                const resolvedInput = await resolveAgentToolInput({
                    params: typedParams,
                    schemaInfo,
                    inputBuilder,
                });
                if (typeof resolvedInput !== 'string' &&
                    !Array.isArray(resolvedInput)) {
                    throw new ModelBehaviorError('Agent tool called with invalid input');
                }
                const inheritedRunConfig = getInheritedAgentToolRunConfig(getAgentToolParentRunConfigFromDetails(details), runConfig);
                const nestedRunConfig = mergeAgentToolRunConfig(inheritedRunConfig, runConfig);
                const runner = new Runner(nestedRunConfig);
                const resumeContextStrategy = resumeState?.contextStrategy ?? 'merge';
                const resumeContext = resumeContextStrategy === 'preferSerialized' ? undefined : runContext;
                let runInput = resolvedInput;
                if (details?.resumeState) {
                    if (resumeContextStrategy === 'preferSerialized' || !resumeContext) {
                        runInput = await RunState.fromString(this, details.resumeState);
                    }
                    else {
                        if (resumeContextStrategy === 'merge' &&
                            context &&
                            resumeContext !== context) {
                            resumeContext._mergeApprovals(context.toJSON().approvals);
                        }
                        runInput = await RunState.fromStringWithContext(this, details.resumeState, resumeContext, {
                            contextStrategy: resumeContextStrategy === 'replace' ? 'replace' : 'merge',
                        });
                    }
                }
                // Only flip to streaming mode when a handler is provided to avoid extra overhead for callers that do not need events.
                // Flip to streaming if either a legacy onStream callback or event handlers are registered; otherwise stay on the non-stream path to avoid extra overhead.
                const shouldStream = typeof onStream === 'function' || eventHandlers.size > 0;
                const configuredSignal = runOptions?.signal;
                const toolCallSignal = details?.signal;
                const { signal: combinedSignal, cleanup: cleanupSignalListeners } = configuredSignal && toolCallSignal
                    ? combineAbortSignals(configuredSignal, toolCallSignal)
                    : {
                        signal: toolCallSignal ?? configuredSignal,
                        cleanup: () => { },
                    };
                const runOptionsWithContext = {
                    ...(runOptions ?? {}),
                    context: runContext,
                    ...(combinedSignal ? { signal: combinedSignal } : {}),
                };
                try {
                    const result = shouldStream
                        ? await runner.run(this, runInput, {
                            ...runOptionsWithContext,
                            stream: true,
                        })
                        : await runner.run(this, runInput, {
                            ...runOptionsWithContext,
                        });
                    const streamPayload = {
                        agent: this,
                        toolCall: details?.toolCall,
                    };
                    if (shouldStream) {
                        // Cast through unknown: the async iterator shape matches and we want to drain the stream for side effects while keeping the public API stable.
                        const streamResult = result;
                        // Drain the stream to deliver every event to registered handlers; ensure completion awaited so the nested run finishes before returning.
                        for await (const event of streamResult) {
                            await emitEvent({
                                event,
                                ...streamPayload,
                            });
                        }
                        await streamResult.completed;
                    }
                    const completedResult = result;
                    if (completedResult.state instanceof RunState) {
                        completedResult.state._agentToolInvocation = agentToolInvocation;
                    }
                    const completedResultWithAgentToolInvocation = completedResult;
                    const usesStopAtToolNames = typeof this.toolUseBehavior === 'object' &&
                        this.toolUseBehavior !== null &&
                        'stopAtToolNames' in this.toolUseBehavior;
                    if (typeof customOutputExtractor !== 'function' &&
                        usesStopAtToolNames) {
                        logger.debug(`You're passing the agent (name: ${this.name}) with toolUseBehavior.stopAtToolNames configured as a tool to a different agent; this may not work as you expect. You may want to have a wrapper function tool to consistently return the final output.`);
                    }
                    let outputText;
                    if (typeof customOutputExtractor === 'function') {
                        outputText = await customOutputExtractor(completedResultWithAgentToolInvocation);
                    }
                    else {
                        const finalOutputText = typeof completedResult.finalOutput !== 'undefined'
                            ? this.outputType === 'text'
                                ? String(completedResult.finalOutput)
                                : JSON.stringify(completedResult.finalOutput)
                            : undefined;
                        const rawResponses = completedResult.rawResponses;
                        const rawOutputText = rawResponses && rawResponses.length > 0
                            ? getOutputText(rawResponses[rawResponses.length - 1])
                            : undefined;
                        const normalizedRawOutputText = typeof rawOutputText === 'string' && rawOutputText.trim() === ''
                            ? undefined
                            : rawOutputText;
                        const prefersFinalOutput = completedResult.state?._finalOutputSource === 'error_handler';
                        outputText = prefersFinalOutput
                            ? (finalOutputText ?? normalizedRawOutputText ?? '')
                            : (normalizedRawOutputText ?? finalOutputText ?? '');
                    }
                    if (details?.toolCall) {
                        saveAgentToolRunResult(details.toolCall, completedResultWithAgentToolInvocation);
                    }
                    return outputText;
                }
                finally {
                    cleanupSignalListeners();
                }
            },
        });
        const agentTool = {
            ...baseTool,
            on: (name, handler) => {
                const set = eventHandlers.get(name) ?? new Set();
                set.add(handler);
                eventHandlers.set(name, set);
                return agentTool;
            },
        };
        registerAgentToolSourceAgent(agentTool, this);
        return agentTool;
    }
    /**
     * Returns the system prompt for the agent.
     *
     * If the agent has a function as its instructions, this function will be called with the
     * runContext and the agent instance.
     */
    async getSystemPrompt(runContext) {
        if (typeof this.instructions === 'function') {
            return await this.instructions(runContext, this);
        }
        return this.instructions;
    }
    /**
     * Returns the prompt template for the agent, if defined.
     *
     * If the agent has a function as its prompt, this function will be called with the
     * runContext and the agent instance.
     */
    async getPrompt(runContext) {
        if (typeof this.prompt === 'function') {
            return await this.prompt(runContext, this);
        }
        return this.prompt;
    }
    /**
     * Fetches the available tools from the MCP servers.
     * @returns the MCP powered tools
     */
    async getMcpTools(runContext) {
        if (this.mcpServers.length > 0) {
            return getAllMcpTools({
                mcpServers: this.mcpServers,
                runContext,
                agent: this,
                convertSchemasToStrict: false,
            });
        }
        return [];
    }
    /**
     * ALl agent tools, including the MCPl and function tools.
     *
     * @returns all configured tools
     */
    async getAllTools(runContext) {
        const mcpTools = await this.getMcpTools(runContext);
        const enabledTools = [];
        for (const candidate of this.tools) {
            if (candidate.type === 'function') {
                const maybeIsEnabled = candidate.isEnabled;
                const enabled = typeof maybeIsEnabled === 'function'
                    ? await maybeIsEnabled(runContext, this)
                    : typeof maybeIsEnabled === 'boolean'
                        ? maybeIsEnabled
                        : true;
                if (!enabled) {
                    continue;
                }
            }
            enabledTools.push(candidate);
        }
        return [...mcpTools, ...enabledTools];
    }
    hasExplicitToolConfig() {
        return this._toolsExplicitlyConfigured;
    }
    /**
     * Returns the handoffs that should be exposed to the model for the current run.
     *
     * Handoffs that provide an `isEnabled` function returning `false` are omitted.
     */
    async getEnabledHandoffs(runContext) {
        const handoffs = this.handoffs?.map((h) => getHandoff(h)) ?? [];
        const enabled = [];
        for (const handoff of handoffs) {
            if (await handoff.isEnabled({ runContext, agent: this })) {
                enabled.push(handoff);
            }
        }
        return enabled;
    }
    /**
     * Processes the final output of the agent.
     *
     * @param output - The output of the agent.
     * @returns The parsed out.
     */
    processFinalOutput(output) {
        if (this.outputType === 'text') {
            return output;
        }
        if (typeof this.outputType === 'object') {
            const parsed = JSON.parse(output);
            if (isZodObject(this.outputType)) {
                return this.outputType.parse(parsed);
            }
            return parsed;
        }
        throw new Error(`Unknown output type: ${this.outputType}`);
    }
    /**
     * Returns a JSON representation of the agent, which is serializable.
     *
     * @returns A JSON object containing the agent's name.
     */
    toJSON() {
        return {
            name: this.name,
        };
    }
}
//# sourceMappingURL=agent.js.map