function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
function getToolSearchProviderData(value) {
    return typeof value.providerData === 'object' && value.providerData
        ? value.providerData
        : undefined;
}
export function toolQualifiedName(name, namespace) {
    if (!isNonEmptyString(name)) {
        return undefined;
    }
    if (isNonEmptyString(namespace)) {
        return `${namespace}.${name}`;
    }
    return name;
}
export function toolDisplayName(name, namespace) {
    if (!isNonEmptyString(name)) {
        return undefined;
    }
    if (!isNonEmptyString(namespace) || namespace === name) {
        return name;
    }
    return `${namespace}.${name}`;
}
export function getToolCallDisplayName(toolCall) {
    return toolDisplayName(isNonEmptyString(toolCall.name) ? toolCall.name : undefined, isNonEmptyString(toolCall.namespace) ? toolCall.namespace : undefined);
}
export function getToolSearchProviderCallId(value) {
    const providerData = getToolSearchProviderData(value);
    const providerCallId = providerData?.call_id ?? providerData?.callId;
    if (isNonEmptyString(providerCallId)) {
        return providerCallId;
    }
    if (isNonEmptyString(value.call_id)) {
        return value.call_id;
    }
    if (isNonEmptyString(value.callId)) {
        return value.callId;
    }
    return undefined;
}
export function getToolSearchMatchKey(value) {
    if (isNonEmptyString(value.id)) {
        return getToolSearchProviderCallId(value) ?? value.id;
    }
    return getToolSearchProviderCallId(value);
}
export function getToolSearchOutputReplacementKey(value) {
    const providerCallId = getToolSearchProviderCallId(value);
    if (providerCallId) {
        return `call:${providerCallId}`;
    }
    return isNonEmptyString(value.id) ? `item:${value.id}` : undefined;
}
export function getToolSearchExecution(value) {
    if (value.execution === 'client' || value.execution === 'server') {
        return value.execution;
    }
    const providerData = getToolSearchProviderData(value);
    const execution = providerData?.execution;
    return execution === 'client' || execution === 'server'
        ? execution
        : undefined;
}
export function isClientToolSearchCall(value) {
    return getToolSearchExecution(value) === 'client';
}
export function shouldQueuePendingToolSearchCall(value) {
    return getToolSearchExecution(value) !== 'server';
}
export function resolveToolSearchCallId(value, generateFallbackId) {
    const explicitMatchKey = getToolSearchMatchKey(value);
    if (explicitMatchKey) {
        return explicitMatchKey;
    }
    if (generateFallbackId) {
        return generateFallbackId();
    }
    throw new Error('Tool search item is missing both call_id and id. Provide a fallback generator when resolving client-side tool_search history.');
}
export function takePendingToolSearchCallId(value, pendingCallIds, generateFallbackId) {
    const explicitCallId = getToolSearchProviderCallId(value);
    if (explicitCallId) {
        const pendingIndex = pendingCallIds.indexOf(explicitCallId);
        if (pendingIndex >= 0) {
            pendingCallIds.splice(pendingIndex, 1);
        }
        return explicitCallId;
    }
    if (getToolSearchExecution(value) === 'server') {
        return resolveToolSearchCallId(value, generateFallbackId);
    }
    return (pendingCallIds.shift() ?? resolveToolSearchCallId(value, generateFallbackId));
}
//# sourceMappingURL=tooling.js.map