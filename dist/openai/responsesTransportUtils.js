import { UserError } from '../core';
function isRecordLike(value) {
    return typeof value === 'object' && value !== null;
}
function isPlainTransportOverrideMapping(value) {
    if (!isRecordLike(value) || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function normalizeTransportOverrideMapping(value, fieldName) {
    if (typeof value === 'undefined') {
        return undefined;
    }
    if (!isPlainTransportOverrideMapping(value)) {
        throw new UserError(`Responses websocket ${fieldName} must be a mapping.`);
    }
    return { ...value };
}
export function splitResponsesTransportOverrides(providerData) {
    if (!isRecordLike(providerData) || Array.isArray(providerData)) {
        return {
            providerData: {},
            overrides: {},
        };
    }
    const { extra_headers, extraHeaders, extra_query, extraQuery, extra_body, extraBody, ...remainingProviderData } = providerData;
    return {
        providerData: { ...remainingProviderData },
        overrides: {
            extraHeaders: normalizeTransportOverrideMapping(typeof extra_headers !== 'undefined' ? extra_headers : extraHeaders, 'extra headers'),
            extraQuery: normalizeTransportOverrideMapping(typeof extra_query !== 'undefined' ? extra_query : extraQuery, 'extra query'),
            extraBody: normalizeTransportOverrideMapping(typeof extra_body !== 'undefined' ? extra_body : extraBody, 'extra_body'),
        },
    };
}
function parseHeaderInput(headers) {
    const parsed = {
        entries: [],
        unsetLowercaseNames: [],
    };
    if (!headers) {
        return parsed;
    }
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach((value, key) => {
            parsed.entries.push([key, value]);
        });
        return parsed;
    }
    if (isRecordLike(headers) && typeof Headers !== 'undefined') {
        const values = headers.values;
        const nulls = headers.nulls;
        if (values instanceof Headers) {
            values.forEach((value, key) => {
                parsed.entries.push([key, value]);
            });
            if (nulls instanceof Set) {
                for (const maybeHeaderName of nulls) {
                    if (typeof maybeHeaderName === 'string') {
                        parsed.unsetLowercaseNames.push(maybeHeaderName.toLowerCase());
                    }
                }
            }
            return parsed;
        }
    }
    if (Array.isArray(headers)) {
        for (const entry of headers) {
            if (!Array.isArray(entry) || entry.length < 2) {
                continue;
            }
            const [key, value] = entry;
            if (typeof key === 'undefined' || value == null) {
                continue;
            }
            parsed.entries.push([String(key), String(value)]);
        }
        return parsed;
    }
    if (!isRecordLike(headers)) {
        return parsed;
    }
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'undefined') {
            continue;
        }
        if (value === null) {
            parsed.unsetLowercaseNames.push(key.toLowerCase());
            continue;
        }
        parsed.entries.push([key, String(value)]);
    }
    return parsed;
}
export function mergeHeadersIntoRecord(target, headers) {
    const parsed = parseHeaderInput(headers);
    for (const lowercaseName of parsed.unsetLowercaseNames) {
        for (const existingKey of Object.keys(target)) {
            if (existingKey.toLowerCase() === lowercaseName) {
                delete target[existingKey];
            }
        }
    }
    for (const [key, value] of parsed.entries) {
        target[key] = value;
    }
}
export function createHeaderAccumulator() {
    return {
        blockedLowercaseNames: new Set(),
        valuesByLowercaseName: new Map(),
    };
}
export function applyHeadersToAccumulator(accumulator, headers, options) {
    const allowBlockedOverride = options?.allowBlockedOverride ?? false;
    const parsed = parseHeaderInput(headers);
    for (const lowercaseName of parsed.unsetLowercaseNames) {
        accumulator.valuesByLowercaseName.delete(lowercaseName);
        accumulator.blockedLowercaseNames.add(lowercaseName);
    }
    for (const [key, value] of parsed.entries) {
        const lowercaseKey = key.toLowerCase();
        if (accumulator.blockedLowercaseNames.has(lowercaseKey) &&
            !allowBlockedOverride) {
            continue;
        }
        accumulator.valuesByLowercaseName.set(lowercaseKey, { key, value });
        if (allowBlockedOverride) {
            accumulator.blockedLowercaseNames.delete(lowercaseKey);
        }
    }
}
export function headerAccumulatorToRecord(accumulator) {
    const headers = {};
    for (const { key, value } of accumulator.valuesByLowercaseName.values()) {
        headers[key] = value;
    }
    return headers;
}
export function headerAccumulatorToSDKHeaders(accumulator) {
    const headers = headerAccumulatorToRecord(accumulator);
    for (const lowercaseName of accumulator.blockedLowercaseNames) {
        headers[lowercaseName] = null;
    }
    return headers;
}
function appendQueryParamValue(url, key, rawValue) {
    if (typeof rawValue === 'undefined' || rawValue === null) {
        return;
    }
    if (Array.isArray(rawValue)) {
        for (const value of rawValue) {
            appendQueryParamValue(url, `${key}[]`, value);
        }
        return;
    }
    if (isPlainTransportOverrideMapping(rawValue)) {
        for (const [nestedKey, nestedValue] of Object.entries(rawValue)) {
            appendQueryParamValue(url, `${key}[${nestedKey}]`, nestedValue);
        }
        return;
    }
    if (rawValue instanceof Date) {
        url.searchParams.append(key, rawValue.toISOString());
        return;
    }
    url.searchParams.append(key, String(rawValue));
}
export function mergeQueryParamsIntoURL(url, query) {
    if (!query) {
        return;
    }
    for (const [key, rawValue] of Object.entries(query)) {
        if (typeof rawValue === 'undefined') {
            continue;
        }
        for (const existingKey of Array.from(url.searchParams.keys())) {
            if (existingKey === key || existingKey.startsWith(`${key}[`)) {
                url.searchParams.delete(existingKey);
            }
        }
        if (rawValue === null) {
            continue;
        }
        appendQueryParamValue(url, key, rawValue);
    }
}
export function ensureResponsesWebSocketPath(pathname) {
    const normalizedPath = pathname.replace(/\/+$/, '');
    if (normalizedPath === '/responses' ||
        normalizedPath.endsWith('/responses')) {
        return normalizedPath;
    }
    return `${normalizedPath}/responses`;
}
//# sourceMappingURL=responsesTransportUtils.js.map