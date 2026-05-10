import { mergeModelSettings } from './runner/modelSettingsMerge';
const TRANSPORT_OVERRIDE_PROVIDER_DATA_ALIAS_KEYS = [
    ['extra_headers', 'extraHeaders'],
    ['extra_query', 'extraQuery'],
    ['extra_body', 'extraBody'],
];
const AGENT_TOOL_PARENT_RUN_CONFIG_SYMBOL = Symbol('openai.agents.agentToolParentRunConfig');
function isPlainObjectLike(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
export function setAgentToolParentRunConfigOnDetails(details, parentRunConfig) {
    const safeParentRunConfig = getInheritedAgentToolRunConfig(parentRunConfig, undefined);
    if (!safeParentRunConfig) {
        return;
    }
    Object.defineProperty(details, AGENT_TOOL_PARENT_RUN_CONFIG_SYMBOL, {
        value: safeParentRunConfig,
        enumerable: false,
        configurable: true,
        writable: false,
    });
}
export function getAgentToolParentRunConfigFromDetails(details) {
    if (!details || typeof details !== 'object') {
        return undefined;
    }
    const detailsRecord = details;
    const internalParentRunConfig = detailsRecord[AGENT_TOOL_PARENT_RUN_CONFIG_SYMBOL];
    if (typeof internalParentRunConfig !== 'undefined') {
        return internalParentRunConfig;
    }
    // Backward compatibility for direct/manual tool invocation tests and callers.
    const legacyParentRunConfig = detailsRecord.parentRunConfig;
    return isPlainObjectLike(legacyParentRunConfig)
        ? legacyParentRunConfig
        : undefined;
}
function getSafeInheritedAgentToolModelSettings(modelSettings) {
    if (!modelSettings) {
        return undefined;
    }
    // Tool-selection settings are specific to the outer agent/tool set and can
    // break nested Agent.asTool runs when inherited blindly.
    const { toolChoice: _toolChoice, parallelToolCalls: _parallelToolCalls, ...safeModelSettings } = modelSettings;
    return Object.keys(safeModelSettings).length > 0
        ? safeModelSettings
        : undefined;
}
function mergeNestedObjectMap(targetRecord, inheritedRecord, overrideRecord, key) {
    if (isPlainObjectLike(inheritedRecord[key]) &&
        isPlainObjectLike(overrideRecord[key])) {
        targetRecord[key] = {
            ...inheritedRecord[key],
            ...overrideRecord[key],
        };
    }
}
function getMergedProviderDataAliasMap(providerData, firstKey, secondKey) {
    const firstValue = providerData[firstKey];
    const secondValue = providerData[secondKey];
    const hasFirst = typeof firstValue !== 'undefined';
    const hasSecond = typeof secondValue !== 'undefined';
    if (!hasFirst && !hasSecond) {
        return undefined;
    }
    if ((hasFirst && !isPlainObjectLike(firstValue)) ||
        (hasSecond && !isPlainObjectLike(secondValue))) {
        return undefined;
    }
    return {
        ...(hasFirst ? firstValue : {}),
        ...(hasSecond ? secondValue : {}),
    };
}
function mergeTransportOverrideAliasMaps(targetProviderData, inheritedProviderData, toolProviderData, snakeKey, camelKey) {
    const inheritedMerged = getMergedProviderDataAliasMap(inheritedProviderData, snakeKey, camelKey);
    const toolMerged = getMergedProviderDataAliasMap(toolProviderData, snakeKey, camelKey);
    if (!inheritedMerged || !toolMerged) {
        return;
    }
    const mergedAliasMap = {
        ...inheritedMerged,
        ...toolMerged,
    };
    const aliasKeys = [snakeKey, camelKey];
    for (const aliasKey of aliasKeys) {
        if (hasOwn(inheritedProviderData, aliasKey) ||
            hasOwn(toolProviderData, aliasKey)) {
            targetProviderData[aliasKey] = mergedAliasMap;
        }
    }
}
function mergeAgentToolProviderData(inheritedProviderData, toolProviderData) {
    const mergedProviderData = {
        ...inheritedProviderData,
        ...toolProviderData,
    };
    for (const [snakeKey, camelKey,] of TRANSPORT_OVERRIDE_PROVIDER_DATA_ALIAS_KEYS) {
        mergeNestedObjectMap(mergedProviderData, inheritedProviderData, toolProviderData, snakeKey);
        mergeNestedObjectMap(mergedProviderData, inheritedProviderData, toolProviderData, camelKey);
    }
    for (const [snakeKey, camelKey,] of TRANSPORT_OVERRIDE_PROVIDER_DATA_ALIAS_KEYS) {
        mergeTransportOverrideAliasMaps(mergedProviderData, inheritedProviderData, toolProviderData, snakeKey, camelKey);
    }
    return mergedProviderData;
}
function mergeAgentToolModelSettings(inheritedRunConfig, toolRunConfigOverride) {
    const inheritedModelSettings = inheritedRunConfig.modelSettings;
    const toolModelSettings = toolRunConfigOverride.modelSettings;
    const hasToolModelSettingsOverride = hasOwn(toolRunConfigOverride, 'modelSettings');
    if (!inheritedModelSettings ||
        !hasToolModelSettingsOverride ||
        !toolModelSettings) {
        return undefined;
    }
    const mergedModelSettings = mergeModelSettings(inheritedModelSettings, toolModelSettings);
    const inheritedProviderData = inheritedModelSettings.providerData;
    const toolProviderData = toolModelSettings.providerData;
    const hasToolProviderDataOverride = hasOwn(toolModelSettings, 'providerData');
    if (hasToolProviderDataOverride &&
        isPlainObjectLike(inheritedProviderData) &&
        isPlainObjectLike(toolProviderData)) {
        mergedModelSettings.providerData = mergeAgentToolProviderData(inheritedProviderData, toolProviderData);
    }
    return mergedModelSettings;
}
export function getInheritedAgentToolRunConfig(parentRunConfig, toolRunConfigOverride) {
    if (!parentRunConfig) {
        return undefined;
    }
    const inheritedRunConfig = {};
    const overridesModelProvider = typeof toolRunConfigOverride?.modelProvider !== 'undefined';
    if (typeof parentRunConfig.modelProvider !== 'undefined') {
        inheritedRunConfig.modelProvider = parentRunConfig.modelProvider;
    }
    if (!overridesModelProvider && typeof parentRunConfig.model !== 'undefined') {
        inheritedRunConfig.model = parentRunConfig.model;
    }
    if (!overridesModelProvider &&
        typeof parentRunConfig.modelSettings !== 'undefined') {
        const inheritedModelSettings = getSafeInheritedAgentToolModelSettings(parentRunConfig.modelSettings);
        if (typeof inheritedModelSettings !== 'undefined') {
            inheritedRunConfig.modelSettings = inheritedModelSettings;
        }
    }
    return Object.keys(inheritedRunConfig).length > 0
        ? inheritedRunConfig
        : undefined;
}
export function mergeAgentToolRunConfig(inheritedRunConfig, toolRunConfigOverride) {
    if (!inheritedRunConfig) {
        return toolRunConfigOverride ?? {};
    }
    if (!toolRunConfigOverride) {
        return inheritedRunConfig;
    }
    const mergedRunConfig = {
        ...inheritedRunConfig,
        ...toolRunConfigOverride,
    };
    const mergedModelSettings = mergeAgentToolModelSettings(inheritedRunConfig, toolRunConfigOverride);
    if (typeof mergedModelSettings !== 'undefined') {
        mergedRunConfig.modelSettings = mergedModelSettings;
    }
    return mergedRunConfig;
}
//# sourceMappingURL=agentToolRunConfig.js.map