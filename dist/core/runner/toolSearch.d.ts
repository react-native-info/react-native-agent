import type { Agent } from '../agent';
import type { RunContext } from '../runContext';
import { type HostedMCPTool, type Tool } from '../tool';
import type * as protocol from '../types/protocol';
export declare function addLoadedToolNamesFromToolSearchOutput(toolSearchOutput: protocol.ToolSearchOutputItem, loadedToolNames: Set<string>): void;
export declare function addHostedMcpToolsFromToolSearchOutput(toolSearchOutput: protocol.ToolSearchOutputItem, hostedMcpToolsByServerLabel: Map<string, HostedMCPTool<any>>, options?: {
    preserveExistingServerLabels?: Set<string>;
}): void;
export declare function validateClientToolSearchSupport(tools: Tool<any>[]): void;
export declare function resolveBuiltInClientToolSearchTools(paths: string[], tools: Tool<any>[]): Tool<any>[];
export declare function createClientToolSearchOutputFromTools(toolSearchCall: protocol.ToolSearchCallItem, tools: Tool<any>[]): protocol.ToolSearchOutputItem;
export declare function createBuiltInClientToolSearchOutput(toolSearchCall: protocol.ToolSearchCallItem, tools: Tool<any>[]): protocol.ToolSearchOutputItem;
export declare function executeCustomClientToolSearch<TContext>(args: {
    agent: Agent<TContext, any>;
    runContext: RunContext<TContext>;
    toolSearchCall: protocol.ToolSearchCallItem;
    toolSearchTool: Tool<TContext>;
    tools: Tool<TContext>[];
}): Promise<{
    output: protocol.ToolSearchOutputItem;
    runtimeTools: Tool<TContext>[];
}>;
export declare function getClientToolSearchHelper<TContext>(tools: Tool<TContext>[]): Tool<TContext> | undefined;
