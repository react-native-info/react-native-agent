import { FunctionTool, Tool } from './tool';
import { Logger } from './logger';
import { z } from 'zod';
import { JsonObjectSchemaNonStrict, JsonObjectSchemaStrict, UnknownContext } from './types';
import type { MCPToolFilterCallable, MCPToolFilterStatic, MCPToolMetaResolver } from './mcpUtil';
import type { RunContext } from './runContext';
import type { Agent } from './agent';
export declare const DEFAULT_STDIO_MCP_CLIENT_LOGGER_NAME = "openai-agents:stdio-mcp-client";
export declare const DEFAULT_STREAMABLE_HTTP_MCP_CLIENT_LOGGER_NAME = "openai-agents:streamable-http-mcp-client";
export declare const DEFAULT_SSE_MCP_CLIENT_LOGGER_NAME = "openai-agents:sse-mcp-client";
type MCPToolErrorFunction = (args: {
    context: RunContext;
    error: Error | unknown;
}) => Promise<string> | string;
/**
 * Interface for MCP server implementations.
 * Provides methods for connecting, listing tools, calling tools, and cleanup.
 */
export interface MCPServer {
    cacheToolsList: boolean;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    toolMetaResolver?: MCPToolMetaResolver;
    /**
     * Optional function to convert MCP tool failures into model-visible messages.
     * Set to null to rethrow errors instead of converting them.
     */
    errorFunction?: MCPToolErrorFunction | null;
    connect(): Promise<void>;
    readonly name: string;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
/**
 * Minimal params accepted by MCP resource-listing methods.
 */
export interface MCPListResourcesParams {
    cursor?: string;
    [key: string]: unknown;
}
/**
 * Minimal MCP resource definition used by this SDK.
 */
export interface MCPResource {
    uri: string;
    name?: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
    annotations?: Record<string, unknown>;
    [key: string]: unknown;
}
/**
 * Minimal MCP resource template definition used by this SDK.
 */
export interface MCPResourceTemplate {
    uriTemplate: string;
    name?: string;
    title?: string;
    description?: string;
    mimeType?: string;
    annotations?: Record<string, unknown>;
    [key: string]: unknown;
}
/**
 * Text resource content returned by `readResource`.
 */
export interface MCPTextResourceContent {
    uri: string;
    mimeType?: string;
    text: string;
    [key: string]: unknown;
}
/**
 * Binary resource content returned by `readResource`.
 */
export interface MCPBlobResourceContent {
    uri: string;
    mimeType?: string;
    blob: string;
    [key: string]: unknown;
}
export type MCPResourceContent = MCPTextResourceContent | MCPBlobResourceContent;
/**
 * Result returned by `listResources`.
 */
export interface MCPListResourcesResult {
    resources: MCPResource[];
    nextCursor?: string;
    [key: string]: unknown;
}
/**
 * Result returned by `listResourceTemplates`.
 */
export interface MCPListResourceTemplatesResult {
    resourceTemplates: MCPResourceTemplate[];
    nextCursor?: string;
    [key: string]: unknown;
}
/**
 * Result returned by `readResource`.
 */
export interface MCPReadResourceResult {
    contents: MCPResourceContent[];
    [key: string]: unknown;
}
/**
 * Extended MCP server surface for servers that expose resources.
 */
export interface MCPServerWithResources extends MCPServer {
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
}
export declare abstract class BaseMCPServerStdio implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    toolMetaResolver?: MCPToolMetaResolver;
    errorFunction?: MCPToolErrorFunction | null;
    protected logger: Logger;
    constructor(options: MCPServerStdioOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    abstract listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    abstract readResource(_uri: string): Promise<MCPReadResourceResult>;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
export declare abstract class BaseMCPServerStreamableHttp implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    toolMetaResolver?: MCPToolMetaResolver;
    errorFunction?: MCPToolErrorFunction | null;
    protected logger: Logger;
    constructor(options: MCPServerStreamableHttpOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    abstract listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    abstract readResource(_uri: string): Promise<MCPReadResourceResult>;
    abstract get sessionId(): string | undefined;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
export declare abstract class BaseMCPServerSSE implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    toolMetaResolver?: MCPToolMetaResolver;
    errorFunction?: MCPToolErrorFunction | null;
    protected logger: Logger;
    constructor(options: MCPServerSSEOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null, _meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract listResources(_params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    abstract listResourceTemplates(_params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    abstract readResource(_uri: string): Promise<MCPReadResourceResult>;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
/**
 * Minimum MCP tool data definition.
 * This type definition does not intend to cover all possible properties.
 * It supports the properties that are used in this SDK.
 */
export declare const MCPTool: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    inputSchema: z.ZodObject<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        required: z.ZodArray<z.ZodString>;
        additionalProperties: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type MCPTool = z.infer<typeof MCPTool>;
/**
 * Public interface of an MCP server that provides tools.
 * You can use this class to pass MCP server settings to your agent.
 */
export declare class MCPServerStdio extends BaseMCPServerStdio implements MCPServerWithResources {
    private underlying;
    constructor(options: MCPServerStdioOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp implements MCPServerWithResources {
    private underlying;
    private _cachedToolsSessionId;
    constructor(options: MCPServerStreamableHttpOptions);
    private clearLocalToolsCache;
    get name(): string;
    get sessionId(): string | undefined;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerSSE extends BaseMCPServerSSE implements MCPServerWithResources {
    private underlying;
    constructor(options: MCPServerSSEOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listResources(params?: MCPListResourcesParams): Promise<MCPListResourcesResult>;
    listResourceTemplates(params?: MCPListResourcesParams): Promise<MCPListResourceTemplatesResult>;
    readResource(uri: string): Promise<MCPReadResourceResult>;
    invalidateToolsCache(): Promise<void>;
}
/**
 * Remove cached tools for the given server so the next lookup fetches fresh data.
 *
 * @param serverName - Name of the MCP server whose cache should be cleared.
 */
export declare function invalidateServerToolsCache(serverName: string): Promise<void>;
/**
 * Function signature for generating the MCP tool cache key.
 * Customizable so the cache key can depend on any context—server, agent, runContext, etc.
 */
export type MCPToolCacheKeyGenerator = (params: {
    server: MCPServer;
    agent?: Agent<any, any>;
    runContext?: RunContext<any>;
}) => string;
/**
 * Default cache key generator for MCP tools.
 * Uses server name, or server+agent if using callable filter.
 */
export declare const defaultMCPToolCacheKey: MCPToolCacheKeyGenerator;
/**
 * Options for fetching MCP tools.
 */
export type GetAllMcpToolsOptions<TContext> = {
    mcpServers: MCPServer[];
    convertSchemasToStrict?: boolean;
    runContext?: RunContext<TContext>;
    agent?: Agent<TContext, any>;
    generateMCPToolCacheKey?: MCPToolCacheKeyGenerator;
};
/**
 * Returns all MCP tools from the provided servers, using the function tool conversion.
 * If runContext and agent are provided, callable tool filters will be applied.
 */
export declare function getAllMcpTools<TContext = UnknownContext>(mcpServersOrOpts: MCPServer[] | GetAllMcpToolsOptions<TContext>, runContext?: RunContext<TContext>, agent?: Agent<TContext, any>, convertSchemasToStrict?: boolean): Promise<Tool<TContext>[]>;
/**
 * Converts an MCP tool definition to a function tool for the Agents SDK.
 */
export declare function mcpToFunctionTool(mcpTool: MCPTool, server: MCPServer, convertSchemasToStrict: boolean): FunctionTool<any, JsonObjectSchemaStrict<any>, string> | FunctionTool<any, JsonObjectSchemaNonStrict<any>, string>;
/**
 * Abstract base class for MCP servers that use a ClientSession for communication.
 * Handles session management, tool listing, tool calling, and cleanup.
 */
export interface BaseMCPServerStdioOptions {
    env?: Record<string, string>;
    cwd?: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    encoding?: string;
    encodingErrorHandler?: 'strict' | 'ignore' | 'replace';
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    /**
     * Optional resolver for MCP request metadata (`_meta`) on tool calls.
     * Invoked before calling `callTool`.
     */
    toolMetaResolver?: MCPToolMetaResolver;
    /**
     * Optional function to convert MCP tool failures into model-visible messages.
     * Set to null to rethrow errors instead of converting them.
     */
    errorFunction?: MCPToolErrorFunction | null;
    timeout?: number;
}
export interface DefaultMCPServerStdioOptions extends BaseMCPServerStdioOptions {
    command: string;
    args?: string[];
}
export interface FullCommandMCPServerStdioOptions extends BaseMCPServerStdioOptions {
    fullCommand: string;
}
export type MCPServerStdioOptions = DefaultMCPServerStdioOptions | FullCommandMCPServerStdioOptions;
export interface MCPServerStreamableHttpOptions {
    url: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    /**
     * Optional resolver for MCP request metadata (`_meta`) on tool calls.
     * Invoked before calling `callTool`.
     */
    toolMetaResolver?: MCPToolMetaResolver;
    /**
     * Optional function to convert MCP tool failures into model-visible messages.
     * Set to null to rethrow errors instead of converting them.
     */
    errorFunction?: MCPToolErrorFunction | null;
    timeout?: number;
    authProvider?: any;
    requestInit?: any;
    fetch?: any;
    reconnectionOptions?: any;
    sessionId?: string;
}
export interface MCPServerSSEOptions {
    url: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    /**
     * Optional resolver for MCP request metadata (`_meta`) on tool calls.
     * Invoked before calling `callTool`.
     */
    toolMetaResolver?: MCPToolMetaResolver;
    /**
     * Optional function to convert MCP tool failures into model-visible messages.
     * Set to null to rethrow errors instead of converting them.
     */
    errorFunction?: MCPToolErrorFunction | null;
    timeout?: number;
    authProvider?: any;
    requestInit?: any;
    fetch?: any;
    eventSourceInit?: any;
}
/**
 * Represents a JSON-RPC request message.
 */
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
/**
 * Represents a JSON-RPC notification message (no response expected).
 */
export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}
/**
 * Represents a JSON-RPC response message.
 */
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: any;
}
export interface CallToolResponse extends JsonRpcResponse {
    result: {
        content: {
            type: string;
            text: string;
        }[];
    };
}
export type CallToolResult = CallToolResponse['result'];
export type CallToolResultContent = CallToolResult['content'];
export interface InitializeResponse extends JsonRpcResponse {
    result: {
        protocolVersion: string;
        capabilities: {
            tools: Record<string, unknown>;
        };
        serverInfo: {
            name: string;
            version: string;
        };
    };
}
export type InitializeResult = InitializeResponse['result'];
export {};
