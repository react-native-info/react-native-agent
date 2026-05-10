type UnknownRecord = Record<string, unknown>;
type SnakeCaseKey<S extends string> = S extends `${infer Head}${infer Tail}` ? `${Head extends Lowercase<Head> ? Head : `_${Lowercase<Head>}`}${SnakeCaseKey<Tail>}` : S;
type CamelCaseKey<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}${Capitalize<CamelCaseKey<Tail>>}` : S;
type SnakeCased<T> = T extends readonly unknown[] ? T : T extends UnknownRecord ? {
    [K in keyof T as K extends string ? SnakeCaseKey<K> : K]: SnakeCased<T[K]>;
} : T;
type CamelCased<T> = T extends readonly unknown[] ? {
    [K in keyof T]: CamelCased<T[K]>;
} : T extends UnknownRecord ? {
    [K in keyof T as K extends string ? CamelCaseKey<K> : K]: CamelCased<T[K]>;
} : T;
/**
 * Converts object keys to snake_case recursively while preserving array entries as-is.
 */
export declare function camelOrSnakeToSnakeCase<T>(value: T): SnakeCased<T>;
/**
 * Converts snake_case or camelCase keys of a JSON-like value to camelCase recursively.
 */
export declare function snakeOrCamelToCamelCase<T>(value: T): CamelCased<T>;
/**
 * Returns providerData with reserved top-level keys removed.
 */
export declare function getProviderDataWithoutReservedKeys(value: unknown, reservedKeys: readonly string[]): UnknownRecord;
/**
 * Normalizes providerData keys to snake_case, then removes reserved top-level keys.
 */
export declare function getSnakeCasedProviderDataWithoutReservedKeys(value: unknown, reservedKeys: readonly string[]): UnknownRecord;
export {};
