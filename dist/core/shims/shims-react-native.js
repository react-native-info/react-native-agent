export { EventEmitter as RuntimeEventEmitter } from 'eventemitter3';
//@ts-ignore
export { default as structuredClone } from '@ungap/structured-clone';
// Use function instead of exporting the value to prevent
// circular dependency resolution issues caused by other exports in '@openai/agents-core/_shims'
export function loadEnv() {
    // In React Native, environment variables are typically accessed via react-native-config or similar
    // For now, return empty object as React Native doesn't have process.env by default
    return {};
}
export const randomUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};
// @ts-ignore
export { Readable } from 'stream-browserify';
export { ReadableStream, ReadableStreamDefaultController as ReadableStreamController, TransformStream,
// @ts-ignore
 } from 'web-streams-polyfill';
export class AsyncLocalStorage {
    context = null;
    active = false;
    constructor() { }
    run(context, fn) {
        this.context = context;
        return fn();
    }
    getStore() {
        return this.context;
    }
    enterWith(context) {
        this.context = context;
    }
}
export function isTracingLoopRunningByDefault() {
    return false;
}
export function isBrowserEnvironment() {
    return false;
}
// React Native doesn't support MCP servers in the same way as Node.js
// These are placeholder exports that throw errors if used
export class ReactNativeMCPServerStdio {
    constructor() {
        throw new Error('MCP Server Stdio is not supported in React Native');
    }
}
export class ReactNativeMCPServerStreamableHttp {
    constructor() {
        throw new Error('MCP Server Streamable HTTP is not supported in React Native');
    }
}
export class ReactNativeMCPServerSSE {
    constructor() {
        throw new Error('MCP Server SSE is not supported in React Native');
    }
}
export { MCPServerStdio, MCPServerStreamableHttp, MCPServerSSE, } from './mcp-server/browser';
const exportingClearTimeout = clearTimeout;
export { exportingClearTimeout as clearTimeout };
class ReactNativeTimer {
    constructor() { }
    setTimeout(callback, ms) {
        setTimeout(callback, ms);
        return {
            ref() { return this; },
            unref() { return this; },
            hasRef() { return true; },
            refresh() { return this; },
        };
    }
    clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
    }
}
const timer = new ReactNativeTimer();
export { timer };
//# sourceMappingURL=shims-react-native.js.map