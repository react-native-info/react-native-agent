import { toolDisplayName, toolQualifiedName } from './tooling';
export { toolDisplayName, toolQualifiedName } from './tooling';
export const FUNCTION_TOOL_NAMESPACE = Symbol('functionToolNamespace');
export const FUNCTION_TOOL_NAMESPACE_DESCRIPTION = Symbol('functionToolNamespaceDescription');
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
export function getToolCallNamespace(toolCall) {
    return isNonEmptyString(toolCall.namespace) ? toolCall.namespace : undefined;
}
export function getToolCallName(toolCall) {
    return isNonEmptyString(toolCall.name) ? toolCall.name : undefined;
}
export function getToolCallQualifiedName(toolCall) {
    return toolQualifiedName(getToolCallName(toolCall), getToolCallNamespace(toolCall));
}
export function getToolCallDisplayName(toolCall) {
    return toolDisplayName(getToolCallName(toolCall), getToolCallNamespace(toolCall));
}
function isTopLevelDeferredFunctionTool(candidate, bareName) {
    const tool = candidate;
    return (tool?.type === 'function' &&
        tool.name === bareName &&
        tool.deferLoading === true &&
        !isNonEmptyString(tool?.[FUNCTION_TOOL_NAMESPACE]));
}
export function resolveFunctionToolCallName(toolCall, availableToolNames) {
    const bareName = getToolCallName(toolCall);
    const namespace = getToolCallNamespace(toolCall);
    if (bareName && !namespace && availableToolNames.has(bareName)) {
        return bareName;
    }
    const qualifiedName = getToolCallQualifiedName(toolCall);
    const bareTool = bareName && typeof availableToolNames.get === 'function'
        ? availableToolNames.get(bareName)
        : undefined;
    const preferBareSelfNamespacedDeferredTool = bareName &&
        namespace === bareName &&
        availableToolNames.has(bareName) &&
        isTopLevelDeferredFunctionTool(bareTool, bareName);
    if (qualifiedName && availableToolNames.has(qualifiedName)) {
        if (preferBareSelfNamespacedDeferredTool) {
            return bareName;
        }
        return qualifiedName;
    }
    if (bareName && namespace === bareName && availableToolNames.has(bareName)) {
        return bareName;
    }
    return qualifiedName ?? bareName;
}
export function getExplicitFunctionToolNamespace(tool) {
    const candidate = tool;
    return isNonEmptyString(candidate?.[FUNCTION_TOOL_NAMESPACE])
        ? candidate[FUNCTION_TOOL_NAMESPACE]
        : undefined;
}
export function getFunctionToolNamespace(tool) {
    return getExplicitFunctionToolNamespace(tool);
}
export function getFunctionToolNamespaceDescription(tool) {
    const candidate = tool;
    return isNonEmptyString(candidate?.[FUNCTION_TOOL_NAMESPACE_DESCRIPTION])
        ? candidate[FUNCTION_TOOL_NAMESPACE_DESCRIPTION]
        : undefined;
}
export function getFunctionToolQualifiedName(tool) {
    const candidate = tool;
    return toolQualifiedName(isNonEmptyString(candidate?.name) ? candidate.name : undefined, getFunctionToolNamespace(tool));
}
export function getFunctionToolDisplayName(tool) {
    const candidate = tool;
    return toolDisplayName(isNonEmptyString(candidate?.name) ? candidate.name : undefined, getFunctionToolNamespace(tool));
}
export function matchesFunctionToolName(tool, candidate) {
    if (!isNonEmptyString(candidate)) {
        return false;
    }
    const bareName = getFunctionToolName(tool);
    if (bareName === candidate) {
        return true;
    }
    return getFunctionToolQualifiedName(tool) === candidate;
}
function getFunctionToolName(tool) {
    const candidate = tool;
    return isNonEmptyString(candidate?.name) ? candidate.name : undefined;
}
//# sourceMappingURL=toolIdentity.js.map