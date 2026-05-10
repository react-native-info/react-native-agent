const NESTED_MODEL_SETTINGS_MERGE_KEYS = ['reasoning', 'text'];
function isPlainObjectLike(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
function mergeRetrySettings(targetRecord, inheritedRecord, overrideRecord) {
    if (!isPlainObjectLike(inheritedRecord.retry) ||
        !isPlainObjectLike(overrideRecord.retry)) {
        return;
    }
    const inheritedRetry = inheritedRecord.retry;
    const overrideRetry = overrideRecord.retry;
    const mergedRetry = {
        ...inheritedRetry,
        ...overrideRetry,
    };
    if (isPlainObjectLike(inheritedRetry.backoff) &&
        isPlainObjectLike(overrideRetry.backoff)) {
        mergedRetry.backoff = {
            ...inheritedRetry.backoff,
            ...overrideRetry.backoff,
        };
    }
    targetRecord.retry = mergedRetry;
}
export function mergeModelSettings(inheritedModelSettings, overrideModelSettings) {
    const mergedModelSettings = {
        ...inheritedModelSettings,
        ...overrideModelSettings,
    };
    if (!inheritedModelSettings || !overrideModelSettings) {
        return mergedModelSettings;
    }
    const inheritedModelSettingsRecord = inheritedModelSettings;
    const overrideModelSettingsRecord = overrideModelSettings;
    const mergedModelSettingsRecord = mergedModelSettings;
    for (const key of NESTED_MODEL_SETTINGS_MERGE_KEYS) {
        mergeNestedObjectMap(mergedModelSettingsRecord, inheritedModelSettingsRecord, overrideModelSettingsRecord, key);
    }
    mergeRetrySettings(mergedModelSettingsRecord, inheritedModelSettingsRecord, overrideModelSettingsRecord);
    return mergedModelSettings;
}
//# sourceMappingURL=modelSettingsMerge.js.map