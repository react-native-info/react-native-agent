import { z } from 'zod';
import type { AgentInputItem, JsonObjectSchema } from './types';
import type { ToolInputParametersStrict } from './tool';
export declare const AgentAsToolInputSchema: z.ZodObject<{
    input: z.ZodString;
}, z.core.$strip>;
export type StructuredInputSchemaInfo = {
    summary?: string;
    jsonSchema?: JsonObjectSchema<any>;
};
export type StructuredToolInputBuilderOptions<TParams = unknown> = {
    params: TParams;
    summary?: string;
    jsonSchema?: JsonObjectSchema<any>;
};
export type StructuredToolInputBuilder<TParams = unknown> = (options: StructuredToolInputBuilderOptions<TParams>) => string | AgentInputItem[] | Promise<string | AgentInputItem[]>;
export declare function defaultInputBuilder(options: StructuredToolInputBuilderOptions): string;
export declare function resolveAgentToolInput<TParams>(options: {
    params: TParams;
    schemaInfo?: StructuredInputSchemaInfo;
    inputBuilder?: StructuredToolInputBuilder<TParams>;
}): Promise<string | AgentInputItem[]>;
export declare function buildStructuredInputSchemaInfo(params: ToolInputParametersStrict, toolName: string, includeJsonSchema: boolean): StructuredInputSchemaInfo;
