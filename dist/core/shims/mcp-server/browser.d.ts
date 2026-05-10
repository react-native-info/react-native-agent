import { BaseMCPServerSSE, BaseMCPServerStdio, BaseMCPServerStreamableHttp, CallToolResultContent, MCPListResourcesParams, MCPListResourcesResult, MCPListResourceTemplatesResult, MCPReadResourceResult, MCPServerSSEOptions, MCPServerStdioOptions, MCPServerStreamableHttpOptions, MCPTool } from '../../mcp';
export declare class MCPServerStdio extends BaseMCPServerStdio {
    constructor(params: MCPServerStdioOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(_uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    constructor(params: MCPServerStreamableHttpOptions);
    get name(): string;
    get sessionId(): string | undefined;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(_uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerSSE extends BaseMCPServerSSE {
    constructor(params: MCPServerSSEOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(_uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
