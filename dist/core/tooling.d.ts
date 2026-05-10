type ToolSearchExecution = 'client' | 'server';
type MaybeToolWithNamespace = {
    name?: unknown;
    namespace?: unknown;
};
type MaybeToolSearchItem = {
    id?: unknown;
    providerData?: unknown;
    call_id?: unknown;
    callId?: unknown;
    execution?: unknown;
};
export declare function toolQualifiedName(name: string | undefined, namespace?: string): string | undefined;
export declare function toolDisplayName(name: string | undefined, namespace?: string): string | undefined;
export declare function getToolCallDisplayName(toolCall: MaybeToolWithNamespace): string | undefined;
export declare function getToolSearchProviderCallId(value: MaybeToolSearchItem): string | undefined;
export declare function getToolSearchMatchKey(value: MaybeToolSearchItem): string | undefined;
export declare function getToolSearchOutputReplacementKey(value: MaybeToolSearchItem): string | undefined;
export declare function getToolSearchExecution(value: MaybeToolSearchItem): ToolSearchExecution | undefined;
export declare function isClientToolSearchCall(value: MaybeToolSearchItem): boolean;
export declare function shouldQueuePendingToolSearchCall(value: MaybeToolSearchItem): boolean;
export declare function resolveToolSearchCallId(value: MaybeToolSearchItem, generateFallbackId?: () => string): string;
export declare function takePendingToolSearchCallId(value: MaybeToolSearchItem, pendingCallIds: string[], generateFallbackId?: () => string): string;
export {};
