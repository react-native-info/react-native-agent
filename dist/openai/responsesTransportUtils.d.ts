export type ResponsesTransportOverrides = {
    extraHeaders?: Record<string, unknown>;
    extraQuery?: Record<string, unknown>;
    extraBody?: Record<string, unknown>;
};
export type HeaderAccumulator = {
    blockedLowercaseNames: Set<string>;
    valuesByLowercaseName: Map<string, {
        key: string;
        value: string;
    }>;
};
export type NullableHeadersLike = {
    values: Headers;
    nulls: Set<string>;
};
export declare function splitResponsesTransportOverrides(providerData: unknown): {
    providerData: Record<string, any>;
    overrides: ResponsesTransportOverrides;
};
export declare function mergeHeadersIntoRecord(target: Record<string, string>, headers: unknown): void;
export declare function createHeaderAccumulator(): HeaderAccumulator;
export declare function applyHeadersToAccumulator(accumulator: HeaderAccumulator, headers: unknown, options?: {
    allowBlockedOverride?: boolean;
}): void;
export declare function headerAccumulatorToRecord(accumulator: HeaderAccumulator): Record<string, string>;
export declare function headerAccumulatorToSDKHeaders(accumulator: HeaderAccumulator): Record<string, string | null>;
export declare function mergeQueryParamsIntoURL(url: URL, query: Record<string, unknown> | undefined): void;
export declare function ensureResponsesWebSocketPath(pathname: string): string;
