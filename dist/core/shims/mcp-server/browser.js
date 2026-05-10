import { BaseMCPServerSSE, BaseMCPServerStdio, BaseMCPServerStreamableHttp, } from '../../mcp';
export class MCPServerStdio extends BaseMCPServerStdio {
    constructor(params) {
        super(params);
    }
    get name() {
        return 'MCPServerStdio';
    }
    connect() {
        throw new Error('Method not implemented.');
    }
    close() {
        throw new Error('Method not implemented.');
    }
    listTools() {
        throw new Error('Method not implemented.');
    }
    callTool(_toolName, _args, _meta) {
        throw new Error('Method not implemented.');
    }
    listResources(_params) {
        throw new Error('Method not implemented.');
    }
    listResourceTemplates(_params) {
        throw new Error('Method not implemented.');
    }
    readResource(_uri) {
        throw new Error('Method not implemented.');
    }
    invalidateToolsCache() {
        throw new Error('Method not implemented.');
    }
}
export class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    constructor(params) {
        super(params);
    }
    get name() {
        return 'MCPServerStdio';
    }
    get sessionId() {
        return undefined;
    }
    connect() {
        throw new Error('Method not implemented.');
    }
    close() {
        throw new Error('Method not implemented.');
    }
    listTools() {
        throw new Error('Method not implemented.');
    }
    callTool(_toolName, _args, _meta) {
        throw new Error('Method not implemented.');
    }
    listResources(_params) {
        throw new Error('Method not implemented.');
    }
    listResourceTemplates(_params) {
        throw new Error('Method not implemented.');
    }
    readResource(_uri) {
        throw new Error('Method not implemented.');
    }
    invalidateToolsCache() {
        throw new Error('Method not implemented.');
    }
}
export class MCPServerSSE extends BaseMCPServerSSE {
    constructor(params) {
        super(params);
    }
    get name() {
        return 'MCPServerSSE';
    }
    connect() {
        throw new Error('Method not implemented.');
    }
    close() {
        throw new Error('Method not implemented.');
    }
    listTools() {
        throw new Error('Method not implemented.');
    }
    callTool(_toolName, _args, _meta) {
        throw new Error('Method not implemented.');
    }
    listResources(_params) {
        throw new Error('Method not implemented.');
    }
    listResourceTemplates(_params) {
        throw new Error('Method not implemented.');
    }
    readResource(_uri) {
        throw new Error('Method not implemented.');
    }
    invalidateToolsCache() {
        throw new Error('Method not implemented.');
    }
}
//# sourceMappingURL=browser.js.map