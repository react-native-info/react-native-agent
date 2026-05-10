import { TracingExporter, type Span, type Trace } from '../core';
/**
 * Options for OpenAITracingExporter.
 */
export type OpenAITracingExporterOptions = {
    apiKey?: string;
    organization: string;
    project: string;
    endpoint: string;
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
};
type JsonCompatibleValue = null | string | number | boolean | JsonCompatibleValue[] | {
    [key: string]: JsonCompatibleValue;
};
declare function valueJsonSizeBytes(value: unknown): number;
declare function truncateJsonValueForLimit(value: JsonCompatibleValue, maxBytes: number, depth?: number): JsonCompatibleValue;
declare function truncateMappingForJsonLimit(value: Record<string, JsonCompatibleValue>, maxBytes: number, depth?: number): Record<string, JsonCompatibleValue>;
declare function truncateListForJsonLimit(value: JsonCompatibleValue[], maxBytes: number, depth?: number): JsonCompatibleValue[];
export declare const _openAITracingExporterTestUtils: {
    valueJsonSizeBytes: typeof valueJsonSizeBytes;
    truncateJsonValueForLimit: typeof truncateJsonValueForLimit;
    truncateMappingForJsonLimit: typeof truncateMappingForJsonLimit;
    truncateListForJsonLimit: typeof truncateListForJsonLimit;
};
/**
 * A tracing exporter that exports traces to OpenAI's tracing API.
 */
export declare class OpenAITracingExporter implements TracingExporter {
    #private;
    constructor(options?: Partial<OpenAITracingExporterOptions>);
    export(items: (Trace | Span<any>)[], signal?: AbortSignal): Promise<void>;
}
/**
 * Sets the OpenAI Tracing exporter as the default exporter with a BatchTraceProcessor handling the
 * traces
 */
export declare function setDefaultOpenAITracingExporter(): void;
export {};
