import { safeExecute } from './utils/safeExecute';
import { toFunctionToolName } from './utils/tools';
import { getSchemaAndParserFromInputType } from './utils/tools';
import { isZodObject } from './utils/typeGuards';
import { combineAbortSignals } from './utils/abortSignals';
import { InvalidToolInputError, ToolTimeoutError, UserError } from './errors';
import logger from './logger';
import { getCurrentSpan } from './tracing';
import { toSmartString } from './utils/smartString';
import { FUNCTION_TOOL_NAMESPACE, FUNCTION_TOOL_NAMESPACE_DESCRIPTION, getFunctionToolQualifiedName, } from './toolIdentity';
import { resolveToolInputGuardrails, resolveToolOutputGuardrails, } from './toolGuardrail';
function isComputerProvider(candidate) {
    return (!!candidate &&
        typeof candidate === 'object' &&
        typeof candidate.create === 'function');
}
/**
 * Exposes a computer to the agent as a tool to be called.
 *
 * @param options Additional configuration for the computer tool like specifying the location of your agent
 * @returns a computer tool definition
 */
export function computerTool(options) {
    if (!options.computer) {
        throw new UserError('computerTool requires a computer instance or an initializer function.');
    }
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    const tool = {
        type: 'computer',
        name: options.name ?? 'computer_use_preview',
        computer: options.computer,
        needsApproval,
        onSafetyCheck: options.onSafetyCheck,
    };
    if (typeof options.computer === 'function' ||
        isComputerProvider(options.computer)) {
        computerInitializerMap.set(tool, options.computer);
    }
    return tool;
}
// Keeps per-tool cache of computer instances keyed by RunContext so each run gets its own instance.
const computerCache = new WeakMap();
// Tracks the initializer so we do not overwrite the callable on the tool when we memoize the resolved instance.
const computerInitializerMap = new WeakMap();
// Allows cleanup routines to find all resolved computer instances for a given run context.
const computersByRunContext = new WeakMap();
function getComputerInitializer(tool) {
    const initializer = computerInitializerMap.get(tool);
    if (initializer) {
        return initializer;
    }
    if (typeof tool.computer === 'function' ||
        isComputerProvider(tool.computer)) {
        return tool.computer;
    }
    return undefined;
}
function trackResolvedComputer(tool, runContext, resolved) {
    let resolvedByRun = computersByRunContext.get(runContext);
    if (!resolvedByRun) {
        resolvedByRun = new Map();
        computersByRunContext.set(runContext, resolvedByRun);
    }
    resolvedByRun.set(tool, resolved);
}
/**
 * Returns a computer instance for the provided run context. Caches per run to avoid sharing across runs.
 * @internal
 */
export async function resolveComputer(args) {
    const { tool, runContext } = args;
    // Cache instances per RunContext so a single Computer is not shared across simultaneous runs.
    const toolKey = tool;
    let perContext = computerCache.get(toolKey);
    if (!perContext) {
        perContext = new WeakMap();
        computerCache.set(toolKey, perContext);
    }
    const cached = perContext.get(runContext);
    if (cached) {
        trackResolvedComputer(tool, runContext, cached);
        return cached.computer;
    }
    const initializerConfig = getComputerInitializer(tool);
    const lifecycle = initializerConfig && isComputerProvider(initializerConfig)
        ? initializerConfig
        : isComputerProvider(tool.computer)
            ? tool.computer
            : undefined;
    const initializer = typeof initializerConfig === 'function'
        ? initializerConfig
        : (lifecycle?.create ??
            (typeof tool.computer === 'function'
                ? tool.computer
                : undefined));
    const disposer = lifecycle?.dispose;
    const computer = initializer && typeof initializer === 'function'
        ? await initializer({ runContext })
        : tool.computer;
    if (!computer) {
        throw new UserError('The computer tool did not provide a computer instance.');
    }
    const resolved = {
        computer,
        dispose: disposer,
    };
    perContext.set(runContext, resolved);
    trackResolvedComputer(tool, runContext, resolved);
    tool.computer = computer;
    return computer;
}
/**
 * Disposes any computer instances created for the provided run context.
 * @internal
 */
export async function disposeResolvedComputers({ runContext, }) {
    const resolvedByRun = computersByRunContext.get(runContext);
    if (!resolvedByRun) {
        return;
    }
    computersByRunContext.delete(runContext);
    const disposers = [];
    for (const [tool, resolved] of resolvedByRun.entries()) {
        const perContext = computerCache.get(tool);
        perContext?.delete(runContext);
        const storedInitializer = getComputerInitializer(tool);
        if (storedInitializer) {
            tool.computer = storedInitializer;
        }
        if (resolved.dispose) {
            disposers.push(async () => {
                await resolved.dispose?.({ runContext, computer: resolved.computer });
            });
        }
    }
    for (const dispose of disposers) {
        try {
            await dispose();
        }
        catch (error) {
            logger.warn(`Failed to dispose computer for run context: ${error}`);
        }
    }
}
function normalizeShellToolSkillReference(skill) {
    if (!skill.skillId) {
        throw new UserError('shellTool skill_reference requires a skillId.');
    }
    return skill;
}
function normalizeShellToolInlineSkill(skill) {
    const sourceCandidate = skill.source;
    if (!sourceCandidate || typeof sourceCandidate !== 'object') {
        throw new UserError('shellTool inline skill source is required.');
    }
    const source = sourceCandidate;
    if (source.mediaType !== 'application/zip') {
        throw new UserError('shellTool inline skill source.mediaType must be application/zip.');
    }
    return {
        type: 'inline',
        name: skill.name,
        description: skill.description,
        source: {
            type: 'base64',
            data: source.data,
            mediaType: source.mediaType,
        },
    };
}
function normalizeShellToolContainerSkill(skill) {
    if (skill.type === 'skill_reference') {
        return normalizeShellToolSkillReference(skill);
    }
    return normalizeShellToolInlineSkill(skill);
}
function normalizeShellToolContainerNetworkPolicy(policy) {
    if (!policy) {
        return undefined;
    }
    if (policy.type === 'disabled') {
        return policy;
    }
    return {
        type: 'allowlist',
        allowedDomains: policy.allowedDomains,
        domainSecrets: policy.domainSecrets,
    };
}
function normalizeShellToolEnvironment(environment) {
    if (!environment || environment.type === 'local') {
        return environment ?? { type: 'local' };
    }
    if (environment.type === 'container_auto') {
        return {
            type: 'container_auto',
            fileIds: environment.fileIds,
            memoryLimit: environment.memoryLimit,
            networkPolicy: normalizeShellToolContainerNetworkPolicy(environment.networkPolicy),
            skills: environment.skills?.map(normalizeShellToolContainerSkill),
        };
    }
    const containerId = environment.containerId;
    if (!containerId) {
        throw new UserError('shellTool with container_reference environment requires a containerId.');
    }
    return {
        type: 'container_reference',
        containerId,
    };
}
export function shellTool(options) {
    const environment = normalizeShellToolEnvironment(options.environment);
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    if (environment.type === 'local') {
        const localShell = options.shell;
        if (!localShell) {
            throw new UserError('shellTool with local environment requires a shell implementation.');
        }
        return {
            type: 'shell',
            name: options.name ?? 'shell',
            environment,
            shell: localShell,
            needsApproval,
            onApproval: options.onApproval,
        };
    }
    if (typeof options.shell !== 'undefined') {
        throw new UserError('shellTool with hosted environment does not accept a shell implementation.');
    }
    if (typeof options.needsApproval !==
        'undefined' ||
        typeof options.onApproval !== 'undefined') {
        throw new UserError('shellTool with hosted environment does not support needsApproval or onApproval.');
    }
    return {
        type: 'shell',
        name: options.name ?? 'shell',
        environment,
        needsApproval,
    };
}
export function applyPatchTool(options) {
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    return {
        type: 'apply_patch',
        name: options.name ?? 'apply_patch',
        editor: options.editor,
        needsApproval,
        onApproval: options.onApproval,
    };
}
/**
 * Creates a hosted MCP tool definition.
 *
 * @param options - Configuration for the hosted MCP tool, including server connection details
 * and approval requirements.
 */
export function hostedMcpTool(options) {
    if ('serverUrl' in options) {
        // the MCP servers compatible with the specification
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                server_url: options.serverUrl,
                authorization: options.authorization,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                headers: options.headers,
                server_description: options.serverDescription,
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                server_url: options.serverUrl,
                authorization: options.authorization,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                headers: options.headers,
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
                server_description: options.serverDescription,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
    else if ('connectorId' in options) {
        // OpenAI's connectors
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                connector_id: options.connectorId,
                authorization: options.authorization,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                headers: options.headers,
                server_description: options.serverDescription,
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                connector_id: options.connectorId,
                authorization: options.authorization,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                headers: options.headers,
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
                server_description: options.serverDescription,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
    else {
        // the MCP servers compatible with the specification
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                server_description: options.serverDescription,
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                defer_loading: options.deferLoading,
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
                server_description: options.serverDescription,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
}
export const CLIENT_TOOL_SEARCH_EXECUTOR = Symbol('clientToolSearchExecutor');
export function attachClientToolSearchExecutor(tool, executor) {
    Object.defineProperty(tool, CLIENT_TOOL_SEARCH_EXECUTOR, {
        value: executor,
        enumerable: false,
        configurable: true,
    });
    return tool;
}
export function getClientToolSearchExecutor(tool) {
    if (tool.type !== 'hosted_tool') {
        return undefined;
    }
    return tool[CLIENT_TOOL_SEARCH_EXECUTOR];
}
export function getToolSearchRuntimeToolKey(tool) {
    if (tool.type === 'function') {
        return getFunctionToolQualifiedName(tool) ?? tool.name;
    }
    if (tool.type === 'hosted_tool' &&
        tool.providerData?.type === 'mcp' &&
        typeof tool.providerData.server_label === 'string' &&
        tool.providerData.server_label.length > 0) {
        return `mcp:${tool.providerData.server_label}`;
    }
    return undefined;
}
const FUNCTION_TOOL_TIMEOUT_BEHAVIORS = [
    'error_as_result',
    'raise_exception',
];
const FUNCTION_TOOL_TIMEOUT_ALREADY_ENFORCED = Symbol('functionToolTimeoutAlreadyEnforced');
/**
 * The default function to invoke when an error occurs while running the tool.
 *
 * Always returns `An error occurred while running the tool. Please try again. Error: <error details>`
 *
 * @param context An instance of the current RunContext
 * @param error The error that occurred
 */
function defaultToolErrorFunction(context, error) {
    const details = error instanceof Error ? error.toString() : String(error);
    return `An error occurred while running the tool. Please try again. Error: ${details}`;
}
function defaultFunctionToolTimeoutErrorMessage(args) {
    return `Tool '${args.toolName}' timed out after ${args.timeoutMs}ms.`;
}
const MAX_FUNCTION_TOOL_TIMEOUT_MS = 2_147_483_647;
function cloneObjectWithDescriptorsAndOverrides(value, overrides) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(overrides)) {
        delete descriptors[key];
    }
    const clone = Object.create(Object.getPrototypeOf(value), descriptors);
    return Object.assign(clone, overrides);
}
function normalizeFunctionToolTimeoutConfig(args) {
    const { toolName, timeoutMs, timeoutBehavior, timeoutErrorFunction } = args;
    if (typeof timeoutMs !== 'undefined') {
        if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs)) {
            throw new UserError(`Function tool '${toolName}' timeoutMs must be a finite number in milliseconds.`);
        }
        if (!Number.isFinite(timeoutMs)) {
            throw new UserError(`Function tool '${toolName}' timeoutMs must be finite.`);
        }
        if (timeoutMs <= 0) {
            throw new UserError(`Function tool '${toolName}' timeoutMs must be greater than 0.`);
        }
        if (timeoutMs > MAX_FUNCTION_TOOL_TIMEOUT_MS) {
            throw new UserError(`Function tool '${toolName}' timeoutMs must be less than or equal to ${MAX_FUNCTION_TOOL_TIMEOUT_MS}.`);
        }
    }
    const resolvedBehavior = timeoutBehavior ?? 'error_as_result';
    if (!FUNCTION_TOOL_TIMEOUT_BEHAVIORS.includes(resolvedBehavior)) {
        throw new UserError(`Function tool '${toolName}' timeoutBehavior must be one of: ${FUNCTION_TOOL_TIMEOUT_BEHAVIORS.join(', ')}.`);
    }
    if (typeof timeoutErrorFunction !== 'undefined' &&
        typeof timeoutErrorFunction !== 'function') {
        throw new UserError(`Function tool '${toolName}' timeoutErrorFunction must be a function when provided.`);
    }
    return {
        timeoutMs,
        timeoutBehavior: resolvedBehavior,
        timeoutErrorFunction,
    };
}
async function invokeFunctionToolWithTimeout(args) {
    const { toolName, invoke, runContext, input, details, timeoutMs: configuredTimeoutMs, timeoutBehavior: configuredTimeoutBehavior, timeoutErrorFunction: configuredTimeoutErrorFunction, } = args;
    const { timeoutMs, timeoutBehavior, timeoutErrorFunction } = normalizeFunctionToolTimeoutConfig({
        toolName,
        timeoutMs: configuredTimeoutMs,
        timeoutBehavior: configuredTimeoutBehavior,
        timeoutErrorFunction: configuredTimeoutErrorFunction,
    });
    if (typeof timeoutMs === 'undefined') {
        return invoke(runContext, input, details);
    }
    let timeoutId;
    let timeoutTriggered = false;
    const timeoutController = new AbortController();
    const { signal: invocationSignal, cleanup: cleanupAbortSignals } = combineAbortSignals(details?.signal, timeoutController.signal);
    const invokeDetails = invocationSignal
        ? details
            ? cloneObjectWithDescriptorsAndOverrides(details, {
                signal: invocationSignal,
            })
            : { signal: invocationSignal }
        : details;
    const timeoutError = new ToolTimeoutError({
        toolName,
        timeoutMs,
    });
    try {
        return await Promise.race([
            invoke(runContext, input, invokeDetails),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    timeoutTriggered = true;
                    reject(timeoutError);
                    timeoutController.abort(timeoutError);
                }, timeoutMs);
            }),
        ]);
    }
    catch (error) {
        const isTimeoutError = error === timeoutError ||
            (timeoutTriggered && timeoutController.signal.reason === timeoutError);
        if (!isTimeoutError) {
            throw error;
        }
        if (timeoutBehavior === 'raise_exception') {
            throw timeoutError;
        }
        if (timeoutErrorFunction) {
            return timeoutErrorFunction(runContext, timeoutError);
        }
        return defaultFunctionToolTimeoutErrorMessage({
            toolName,
            timeoutMs,
        });
    }
    finally {
        if (typeof timeoutId !== 'undefined') {
            clearTimeout(timeoutId);
        }
        cleanupAbortSignals();
    }
}
/**
 * Invoke a function tool while enforcing optional per-tool timeout settings.
 */
export async function invokeFunctionTool(args) {
    const { tool, runContext, input, details } = args;
    const invokeWithTimeoutFlag = (invocationRunContext, invocationInput, invocationDetails) => {
        const detailsWithFlag = typeof invocationDetails === 'undefined'
            ? undefined
            : cloneObjectWithDescriptorsAndOverrides(invocationDetails, {
                [FUNCTION_TOOL_TIMEOUT_ALREADY_ENFORCED]: true,
            });
        return tool.invoke(invocationRunContext, invocationInput, detailsWithFlag);
    };
    return invokeFunctionToolWithTimeout({
        toolName: tool.name,
        invoke: invokeWithTimeoutFlag,
        runContext,
        input,
        details,
        timeoutMs: tool.timeoutMs,
        timeoutBehavior: tool.timeoutBehavior,
        timeoutErrorFunction: tool.timeoutErrorFunction,
    });
}
/**
 * Exposes a function to the agent as a tool to be called
 *
 * @param options The options for the tool
 * @returns A new tool
 */
export function tool(options) {
    const name = options.name
        ? toFunctionToolName(options.name)
        : toFunctionToolName(options.execute.name);
    const toolErrorFunction = typeof options.errorFunction === 'undefined'
        ? defaultToolErrorFunction
        : options.errorFunction;
    if (!name) {
        throw new Error('Tool name cannot be empty. Either name your function or provide a name in the options.');
    }
    const strictMode = options.strict ?? true;
    if (!strictMode && isZodObject(options.parameters)) {
        throw new UserError('Strict mode is required for Zod parameters');
    }
    const { timeoutMs, timeoutBehavior, timeoutErrorFunction } = normalizeFunctionToolTimeoutConfig({
        toolName: name,
        timeoutMs: options.timeoutMs,
        timeoutBehavior: options.timeoutBehavior,
        timeoutErrorFunction: options.timeoutErrorFunction,
    });
    const { parser, schema: parameters } = getSchemaAndParserFromInputType(options.parameters, name);
    async function _invoke(runContext, input, details) {
        const [error, parsed] = await safeExecute(() => parser(input));
        if (error !== null) {
            if (logger.dontLogToolData) {
                logger.debug(`Invalid JSON input for tool ${name}`);
            }
            else {
                logger.debug(`Invalid JSON input for tool ${name}: ${input}`);
            }
            // supply the same context as options.execute for consuming
            // downstream code to implement self-healing and/or tracing
            throw new InvalidToolInputError('Invalid JSON input for tool', undefined, // no RunState available in this context
            error, { runContext, input, details });
        }
        if (logger.dontLogToolData) {
            logger.debug(`Invoking tool ${name}`);
        }
        else {
            logger.debug(`Invoking tool ${name} with input ${input}`);
        }
        const result = await options.execute(parsed, runContext, details);
        const stringResult = toSmartString(result);
        if (logger.dontLogToolData) {
            logger.debug(`Tool ${name} completed`);
        }
        else {
            logger.debug(`Tool ${name} returned: ${stringResult}`);
        }
        return result;
    }
    async function invokeWithoutTimeout(runContext, input, details) {
        return _invoke(runContext, input, details).catch((error) => {
            if (details?.signal?.aborted &&
                details.signal.reason instanceof ToolTimeoutError) {
                throw error;
            }
            if (toolErrorFunction) {
                const currentSpan = getCurrentSpan();
                currentSpan?.setError({
                    message: 'Error running tool (non-fatal)',
                    data: {
                        tool_name: name,
                        error: error.toString(),
                    },
                });
                return toolErrorFunction(runContext, error);
            }
            throw error;
        });
    }
    async function invoke(runContext, input, details) {
        const detailsWithFlag = details;
        if (detailsWithFlag?.[FUNCTION_TOOL_TIMEOUT_ALREADY_ENFORCED]) {
            return invokeWithoutTimeout(runContext, input, details);
        }
        return invokeFunctionToolWithTimeout({
            toolName: name,
            invoke: invokeWithoutTimeout,
            runContext,
            input,
            details,
            timeoutMs,
            timeoutBehavior,
            timeoutErrorFunction,
        });
    }
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    const isEnabled = typeof options.isEnabled === 'function'
        ? async (runContext, agent) => {
            const predicate = options.isEnabled;
            const result = await predicate({ runContext, agent });
            return Boolean(result);
        }
        : async () => typeof options.isEnabled === 'boolean' ? options.isEnabled : true;
    return {
        type: 'function',
        name,
        description: options.description,
        parameters,
        strict: strictMode,
        deferLoading: options.deferLoading ?? false,
        invoke,
        needsApproval,
        timeoutMs,
        timeoutBehavior,
        timeoutErrorFunction,
        isEnabled,
        inputGuardrails: resolveToolInputGuardrails(options.inputGuardrails),
        outputGuardrails: resolveToolOutputGuardrails(options.outputGuardrails),
    };
}
/**
 * Responses API only. Group function tools under a shared namespace.
 *
 * @param options - Namespace metadata and function tools to attach.
 * @returns shallow-cloned function tools carrying namespace metadata.
 */
export function toolNamespace(options) {
    if (typeof options !== 'object' || options === null) {
        throw new UserError('toolNamespace() requires a namespace config object.');
    }
    const { name, description, tools } = options;
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new UserError('toolNamespace() requires a non-empty namespace name.');
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
        throw new UserError('toolNamespace() requires a non-empty description because the Responses API requires namespace descriptions.');
    }
    if (!Array.isArray(tools)) {
        throw new UserError('toolNamespace() requires an array of function tools.');
    }
    if (tools.some((tool) => tool?.type !== 'function')) {
        throw new UserError('toolNamespace() only supports FunctionTool instances.');
    }
    const namespaceName = toFunctionToolName(name.trim());
    if (tools.some((tool) => tool.name === namespaceName)) {
        throw new UserError(`toolNamespace() does not allow a tool named "${namespaceName}" inside namespace "${namespaceName}" because Responses self-namespaced calls would be ambiguous.`);
    }
    const normalizedDescription = description.trim();
    return tools.map((tool) => cloneObjectWithDescriptorsAndOverrides(tool, {
        [FUNCTION_TOOL_NAMESPACE]: namespaceName,
        [FUNCTION_TOOL_NAMESPACE_DESCRIPTION]: normalizedDescription,
    }));
}
function buildRequireApproval(requireApproval) {
    const result = {};
    if (requireApproval.always) {
        result.always = { tool_names: requireApproval.always.toolNames };
    }
    if (requireApproval.never) {
        result.never = { tool_names: requireApproval.never.toolNames };
    }
    return result;
}
function toMcpAllowedToolsFilter(allowedTools) {
    if (typeof allowedTools === 'undefined') {
        return undefined;
    }
    if (Array.isArray(allowedTools)) {
        return { tool_names: allowedTools };
    }
    return { tool_names: allowedTools?.toolNames ?? [] };
}
//# sourceMappingURL=tool.js.map