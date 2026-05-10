import type { FunctionTool } from './tool';
export { toolDisplayName, toolQualifiedName } from './tooling';
export declare const FUNCTION_TOOL_NAMESPACE: unique symbol;
export declare const FUNCTION_TOOL_NAMESPACE_DESCRIPTION: unique symbol;
type MaybeToolCallWithNamespace = {
    name?: unknown;
    namespace?: unknown;
};
export declare function getToolCallNamespace(toolCall: MaybeToolCallWithNamespace): string | undefined;
export declare function getToolCallName(toolCall: MaybeToolCallWithNamespace): string | undefined;
export declare function getToolCallQualifiedName(toolCall: MaybeToolCallWithNamespace): string | undefined;
export declare function getToolCallDisplayName(toolCall: MaybeToolCallWithNamespace): string | undefined;
type ToolNameLookup = {
    has(name: string): boolean;
    get?(name: string): unknown;
};
export declare function resolveFunctionToolCallName(toolCall: MaybeToolCallWithNamespace, availableToolNames: ToolNameLookup): string | undefined;
export declare function getExplicitFunctionToolNamespace(tool: unknown): string | undefined;
export declare function getFunctionToolNamespace(tool: unknown): string | undefined;
export declare function getFunctionToolNamespaceDescription(tool: unknown): string | undefined;
export declare function getFunctionToolQualifiedName(tool: Pick<FunctionTool<any, any, any>, 'name'> | unknown): string | undefined;
export declare function getFunctionToolDisplayName(tool: Pick<FunctionTool<any, any, any>, 'name'> | unknown): string | undefined;
export declare function matchesFunctionToolName(tool: Pick<FunctionTool<any, any, any>, 'name'> | unknown, candidate: string | undefined): boolean;
