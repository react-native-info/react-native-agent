/**
 * Converts object keys to snake_case recursively while preserving array entries as-is.
 */
export function camelOrSnakeToSnakeCase(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }
    if (!isRecord(value)) {
        return value;
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        result[snakeKey] = camelOrSnakeToSnakeCase(entry);
    }
    return result;
}
/**
 * Converts snake_case or camelCase keys of a JSON-like value to camelCase recursively.
 */
export function snakeOrCamelToCamelCase(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => snakeOrCamelToCamelCase(entry));
    }
    if (!isRecord(value)) {
        return value;
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        const camelKey = key.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());
        result[camelKey] = snakeOrCamelToCamelCase(entry);
    }
    return result;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toSnakeCase(key) {
    return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}
function omitReservedKeys(value, reservedKeys) {
    if (!isRecord(value)) {
        return {};
    }
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (reservedKeys.has(key)) {
            continue;
        }
        result[key] = entry;
    }
    return result;
}
/**
 * Returns providerData with reserved top-level keys removed.
 */
export function getProviderDataWithoutReservedKeys(value, reservedKeys) {
    return omitReservedKeys(value, new Set(reservedKeys));
}
/**
 * Normalizes providerData keys to snake_case, then removes reserved top-level keys.
 */
export function getSnakeCasedProviderDataWithoutReservedKeys(value, reservedKeys) {
    return omitReservedKeys(camelOrSnakeToSnakeCase(value), new Set(reservedKeys.map((key) => toSnakeCase(key))));
}
//# sourceMappingURL=providerData.js.map