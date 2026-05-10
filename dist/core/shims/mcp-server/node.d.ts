import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BaseMCPServerStdio, BaseMCPServerStreamableHttp, BaseMCPServerSSE, CallToolResultContent, DefaultMCPServerStdioOptions, InitializeResult, MCPListResourcesParams, MCPListResourcesResult, MCPListResourceTemplatesResult, MCPReadResourceResult, MCPServerStdioOptions, MCPServerStreamableHttpOptions, MCPServerSSEOptions, MCPTool } from '../../mcp';
export interface SessionMessage {
    message: any;
}
export declare class NodeMCPServerStdio extends BaseMCPServerStdio {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: DefaultMCPServerStdioOptions;
    private _name;
    private transport;
    constructor(params: MCPServerStdioOptions);
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    get name(): string;
    close(): Promise<void>;
}
export declare class NodeMCPServerSSE extends BaseMCPServerSSE {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: MCPServerSSEOptions;
    private _name;
    private transport;
    constructor(params: MCPServerSSEOptions);
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    get name(): string;
    close(): Promise<void>;
}
export declare class NodeMCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: MCPServerStreamableHttpOptions;
    private _name;
    private transport;
    private reconnectingClientPromise;
    private reconnectingClientTarget;
    private isClosed;
    private connectionStateVersion;
    constructor(params: MCPServerStreamableHttpOptions);
    private loadStreamableHttpRuntime;
    private createStreamableHttpTransport;
    private createConnectedStreamableHttpClient;
    private getClientSessionTimeoutMs;
    private resetClientToolMetadataCache;
    private publishConnectedStreamableHttpClient;
    private clearPublishedStreamableHttpClientIfCurrent;
    private reopenSharedStreamableHttpSession;
    private terminateDetachedStreamableHttpSession;
    private closeCloseOwnedStreamableHttpState;
    private callToolWithClient;
    private closeStreamableHttpClient;
    private reconnectExistingStreamableHttpClient;
    private reconnectClosedStreamableHttpClient;
    private shouldReconnectClosedStreamableHttpClient;
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    get name(): string;
    get sessionId(): string | undefined;
    close(): Promise<void>;
}
