import { UserError } from '../errors';
import { getClientToolSearchExecutor, getToolSearchRuntimeToolKey, } from '../tool';
import { getExplicitFunctionToolNamespace, getFunctionToolNamespaceDescription, getFunctionToolQualifiedName, toolQualifiedName, } from '../toolIdentity';
import { serializeTool } from '../utils/serialize';
import { resolveToolSearchCallId } from '../utils/toolSearch';
function isDeferredFunctionTool(tool) {
    return tool.type === 'function' && tool.deferLoading === true;
}
function isTopLevelDeferredFunctionTool(tool) {
    return (isDeferredFunctionTool(tool) && !getExplicitFunctionToolNamespace(tool));
}
function isDeferredHostedMcpTool(tool) {
    return (tool.type === 'hosted_tool' &&
        tool.providerData?.type === 'mcp' &&
        tool.providerData.defer_loading === true);
}
function getBuiltInClientToolSearchArguments(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const paths = value.paths;
    if (!Array.isArray(paths)) {
        return undefined;
    }
    return {
        paths: paths.filter((path) => typeof path === 'string' && path.length > 0),
    };
}
function getDeferredFunctionToolsByName(tools) {
    return new Map(tools
        .filter(isTopLevelDeferredFunctionTool)
        .map((tool) => [tool.name, tool]));
}
function getDeferredNamespaceToolsByName(tools) {
    const namespaces = new Map();
    for (const tool of tools) {
        if (!isDeferredFunctionTool(tool)) {
            continue;
        }
        const namespace = getExplicitFunctionToolNamespace(tool);
        if (!namespace) {
            continue;
        }
        const description = getFunctionToolNamespaceDescription(tool);
        if (!description) {
            throw new UserError(`Deferred namespace "${namespace}" must provide a description for built-in client tool_search.`);
        }
        const existing = namespaces.get(namespace);
        if (!existing) {
            namespaces.set(namespace, { description, tools: [tool] });
            continue;
        }
        existing.tools.push(tool);
    }
    return namespaces;
}
function getDeferredHostedMcpToolsByServerLabel(tools) {
    return new Map(tools
        .filter(isDeferredHostedMcpTool)
        .map((tool) => [tool.providerData.server_label, tool]));
}
function getDeferredNamespacedFunctionToolsByQualifiedName(tools) {
    const qualifiedTools = new Map();
    for (const tool of tools) {
        if (!isDeferredFunctionTool(tool)) {
            continue;
        }
        const namespace = getExplicitFunctionToolNamespace(tool);
        if (!namespace) {
            continue;
        }
        const description = getFunctionToolNamespaceDescription(tool);
        const qualifiedName = getFunctionToolQualifiedName(tool);
        if (!description || !qualifiedName) {
            continue;
        }
        qualifiedTools.set(qualifiedName, { namespace, description, tool });
    }
    return qualifiedTools;
}
function serializeFunctionToolForToolSearchOutput(tool) {
    const serialized = serializeTool(tool);
    const namespace = getExplicitFunctionToolNamespace(tool);
    if (!namespace) {
        return serialized;
    }
    const { namespace: _namespace, namespaceDescription, ...toolPayload } = serialized;
    void namespaceDescription;
    return toolPayload;
}
function serializeHostedMcpToolForToolSearchOutput(tool) {
    const { on_approval: _onApproval, ...providerData } = tool.providerData;
    void _onApproval;
    return providerData;
}
function appendNamespaceMemberToolSearchOutput(args) {
    const { namespace, description, tool, namespaceOutputIndexByName, resolvedTools, } = args;
    const existingIndex = namespaceOutputIndexByName.get(namespace);
    const serializedTool = serializeFunctionToolForToolSearchOutput(tool);
    if (typeof existingIndex === 'number') {
        const existingNamespace = resolvedTools[existingIndex];
        if (existingNamespace?.type === 'namespace' &&
            Array.isArray(existingNamespace.tools)) {
            existingNamespace.tools.push(serializedTool);
            return;
        }
    }
    namespaceOutputIndexByName.set(namespace, resolvedTools.length);
    resolvedTools.push({
        type: 'namespace',
        name: namespace,
        description,
        tools: [serializedTool],
    });
}
function isClientToolSearchToolWithCustomParameters(tool) {
    return (tool.type === 'hosted_tool' &&
        tool.providerData?.type === 'tool_search' &&
        tool.providerData.execution === 'client' &&
        tool.providerData.parameters != null);
}
function isClientToolSearchTool(tool) {
    return (tool.type === 'hosted_tool' &&
        tool.providerData?.type === 'tool_search' &&
        tool.providerData.execution === 'client');
}
function normalizeClientToolSearchExecutorResult(result) {
    if (typeof result === 'undefined' || result === null) {
        return [];
    }
    return Array.isArray(result) ? result : [result];
}
function addLoadedToolName(loadedToolNames, name, namespace) {
    if (typeof name !== 'string' || name.length === 0) {
        return;
    }
    const explicitNamespace = typeof namespace === 'string' && namespace.length > 0
        ? namespace
        : undefined;
    const qualifiedName = toolQualifiedName(name, explicitNamespace);
    if (qualifiedName) {
        loadedToolNames.add(qualifiedName);
    }
    if (!explicitNamespace || explicitNamespace === name) {
        loadedToolNames.add(name);
    }
}
function collectLoadedToolNamesFromSearchResult(searchResult, loadedToolNames, namespace) {
    if (!searchResult || typeof searchResult !== 'object') {
        return;
    }
    const candidate = searchResult;
    if (candidate.type === 'tool_reference') {
        addLoadedToolName(loadedToolNames, candidate.functionName, candidate.namespace ?? namespace);
        return;
    }
    if (candidate.type === 'function') {
        addLoadedToolName(loadedToolNames, candidate.name, candidate.namespace ?? namespace);
        return;
    }
    const mcpProviderData = getHostedMcpProviderDataFromSearchResult(candidate);
    if (mcpProviderData) {
        addLoadedToolName(loadedToolNames, mcpProviderData.server_label);
        return;
    }
    if (candidate.type === 'namespace' && Array.isArray(candidate.tools)) {
        const nestedNamespace = typeof candidate.name === 'string' && candidate.name.length > 0
            ? candidate.name
            : namespace;
        for (const nestedTool of candidate.tools) {
            collectLoadedToolNamesFromSearchResult(nestedTool, loadedToolNames, nestedNamespace);
        }
    }
}
function normalizeStringRecord(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const entries = Object.entries(value).filter(([key, entryValue]) => typeof key === 'string' && typeof entryValue === 'string');
    if (entries.length === 0) {
        return undefined;
    }
    return Object.fromEntries(entries);
}
function normalizeHostedMcpProviderData(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const candidate = value;
    if (candidate.type !== 'mcp' ||
        typeof candidate.server_label !== 'string' ||
        candidate.server_label.length === 0) {
        return undefined;
    }
    const normalized = {
        type: 'mcp',
        server_label: candidate.server_label,
        require_approval: candidate.require_approval === undefined
            ? 'never'
            : candidate.require_approval,
    };
    if (typeof candidate.server_url === 'string') {
        normalized.server_url = candidate.server_url;
    }
    if (typeof candidate.connector_id === 'string') {
        normalized.connector_id = candidate.connector_id;
    }
    if (typeof candidate.authorization === 'string') {
        normalized.authorization = candidate.authorization;
    }
    if (candidate.allowed_tools !== undefined) {
        normalized.allowed_tools =
            candidate.allowed_tools;
    }
    if (candidate.defer_loading === true) {
        normalized.defer_loading = true;
    }
    const headers = normalizeStringRecord(candidate.headers);
    if (headers) {
        normalized.headers = headers;
    }
    if (typeof candidate.server_description === 'string') {
        normalized.server_description = candidate.server_description;
    }
    return normalized;
}
function getHostedMcpProviderDataFromSearchResult(searchResult) {
    const directProviderData = normalizeHostedMcpProviderData(searchResult);
    if (directProviderData) {
        return directProviderData;
    }
    if (!searchResult || typeof searchResult !== 'object') {
        return undefined;
    }
    const hostedCandidate = searchResult;
    if (hostedCandidate.type !== 'hosted_tool') {
        return undefined;
    }
    return normalizeHostedMcpProviderData(hostedCandidate.providerData);
}
export function addLoadedToolNamesFromToolSearchOutput(toolSearchOutput, loadedToolNames) {
    for (const tool of toolSearchOutput.tools) {
        collectLoadedToolNamesFromSearchResult(tool, loadedToolNames);
    }
}
export function addHostedMcpToolsFromToolSearchOutput(toolSearchOutput, hostedMcpToolsByServerLabel, options) {
    const preserveExistingServerLabels = options?.preserveExistingServerLabels;
    for (const tool of toolSearchOutput.tools) {
        const providerData = getHostedMcpProviderDataFromSearchResult(tool);
        if (!providerData) {
            continue;
        }
        if (preserveExistingServerLabels?.has(providerData.server_label) &&
            hostedMcpToolsByServerLabel.has(providerData.server_label)) {
            continue;
        }
        hostedMcpToolsByServerLabel.set(providerData.server_label, {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        });
    }
}
export function validateClientToolSearchSupport(tools) {
    if (!tools.some((tool) => isClientToolSearchToolWithCustomParameters(tool) &&
        !getClientToolSearchExecutor(tool))) {
        return;
    }
    throw new UserError('Runner.run() and Runner.runStreamed() require toolSearchTool({ execution: "client", execute }) when custom client tool_search parameters are provided. Leave parameters unset to use the default built-in { paths: string[] } loader, or use server execution / a custom model loop instead.');
}
export function resolveBuiltInClientToolSearchTools(paths, tools) {
    const deferredToolsByName = getDeferredFunctionToolsByName(tools);
    const deferredNamespaceToolsByName = getDeferredNamespaceToolsByName(tools);
    const deferredNamespacedToolsByQualifiedName = getDeferredNamespacedFunctionToolsByQualifiedName(tools);
    const deferredHostedMcpToolsByServerLabel = getDeferredHostedMcpToolsByServerLabel(tools);
    const ambiguousPath = paths.find((path) => Number(deferredToolsByName.has(path)) +
        Number(deferredNamespaceToolsByName.has(path)) +
        Number(deferredNamespacedToolsByQualifiedName.has(path)) +
        Number(deferredHostedMcpToolsByServerLabel.has(path)) >
        1);
    if (ambiguousPath) {
        throw new UserError(`Runner.run() and Runner.runStreamed() cannot disambiguate built-in client tool_search path "${ambiguousPath}" because it matches multiple deferred tool_search surfaces. Rename one of them or use server tool_search execution.`);
    }
    const requestedNamespacePaths = new Set(paths.filter((path) => deferredNamespaceToolsByName.has(path)));
    const resolvedTools = [];
    const seenPaths = new Set();
    const resolvedQualifiedNames = new Set();
    for (const path of paths) {
        if (seenPaths.has(path)) {
            continue;
        }
        seenPaths.add(path);
        const tool = deferredToolsByName.get(path);
        if (!tool) {
            const namespaceTools = deferredNamespaceToolsByName.get(path);
            if (namespaceTools) {
                const unresolvedTools = namespaceTools.tools.filter((tool) => {
                    const qualifiedName = getFunctionToolQualifiedName(tool);
                    return !qualifiedName || !resolvedQualifiedNames.has(qualifiedName);
                });
                if (unresolvedTools.length === 0) {
                    continue;
                }
                for (const namespaceTool of unresolvedTools) {
                    const qualifiedName = getFunctionToolQualifiedName(namespaceTool);
                    if (qualifiedName) {
                        resolvedQualifiedNames.add(qualifiedName);
                    }
                }
                resolvedTools.push(...unresolvedTools);
                continue;
            }
            const namespacedTool = deferredNamespacedToolsByQualifiedName.get(path);
            if (namespacedTool) {
                if (requestedNamespacePaths.has(namespacedTool.namespace)) {
                    continue;
                }
                if (resolvedQualifiedNames.has(path)) {
                    continue;
                }
                resolvedQualifiedNames.add(path);
                resolvedTools.push(namespacedTool.tool);
                continue;
            }
        }
        if (tool) {
            resolvedTools.push(tool);
            continue;
        }
        const hostedMcpTool = deferredHostedMcpToolsByServerLabel.get(path);
        if (hostedMcpTool) {
            resolvedTools.push(hostedMcpTool);
        }
    }
    return resolvedTools;
}
export function createClientToolSearchOutputFromTools(toolSearchCall, tools) {
    const callId = resolveToolSearchCallId(toolSearchCall);
    const resolvedTools = [];
    const namespaceOutputIndexByName = new Map();
    const seenToolKeys = new Set();
    for (const tool of tools) {
        const runtimeToolKey = getToolSearchRuntimeToolKey(tool);
        if (runtimeToolKey && seenToolKeys.has(runtimeToolKey)) {
            continue;
        }
        if (runtimeToolKey) {
            seenToolKeys.add(runtimeToolKey);
        }
        if (tool.type === 'function') {
            const namespace = getExplicitFunctionToolNamespace(tool);
            if (namespace) {
                const description = getFunctionToolNamespaceDescription(tool);
                if (!description) {
                    throw new UserError(`Client tool_search execute() returned namespace member "${namespace}.${tool.name}" without a namespace description.`);
                }
                appendNamespaceMemberToolSearchOutput({
                    namespace,
                    description,
                    tool,
                    namespaceOutputIndexByName,
                    resolvedTools,
                });
                continue;
            }
            resolvedTools.push(serializeFunctionToolForToolSearchOutput(tool));
            continue;
        }
        if (isDeferredHostedMcpTool(tool) || tool.type === 'hosted_tool') {
            if (tool.type === 'hosted_tool' && tool.providerData?.type === 'mcp') {
                resolvedTools.push(serializeHostedMcpToolForToolSearchOutput(tool));
                continue;
            }
        }
        throw new UserError('Client tool_search execute() may only return function tools or hosted MCP tools.');
    }
    return {
        type: 'tool_search_output',
        status: 'completed',
        tools: resolvedTools,
        providerData: {
            call_id: callId,
            execution: 'client',
        },
    };
}
export function createBuiltInClientToolSearchOutput(toolSearchCall, tools) {
    const callId = resolveToolSearchCallId(toolSearchCall);
    const builtInArgs = getBuiltInClientToolSearchArguments(toolSearchCall.arguments);
    if (!builtInArgs) {
        throw new UserError(`Runner.run() and Runner.runStreamed() only auto-execute built-in client tool_search calls with { paths: string[] }. Custom client tool_search schemas require toolSearchTool({ execution: "client", execute }) or a custom model loop before re-processing call ${callId}.`);
    }
    return createClientToolSearchOutputFromTools(toolSearchCall, resolveBuiltInClientToolSearchTools(builtInArgs.paths, tools));
}
export async function executeCustomClientToolSearch(args) {
    const { agent, runContext, toolSearchCall, toolSearchTool, tools } = args;
    const executor = getClientToolSearchExecutor(toolSearchTool);
    if (!executor) {
        throw new UserError('Client tool_search execution requires a registered execute callback.');
    }
    const runtimeTools = normalizeClientToolSearchExecutorResult(await executor({
        agent,
        availableTools: [...tools],
        loadDefault: (paths) => resolveBuiltInClientToolSearchTools(paths, tools),
        runContext,
        toolCall: toolSearchCall,
    }));
    return {
        output: createClientToolSearchOutputFromTools(toolSearchCall, runtimeTools),
        runtimeTools,
    };
}
export function getClientToolSearchHelper(tools) {
    return tools.find(isClientToolSearchTool);
}
//# sourceMappingURL=toolSearch.js.map