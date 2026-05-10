import { Timeout, Timer } from './interface';
export { EventEmitter, EventEmitterEvents } from './interface';
export { EventEmitter as RuntimeEventEmitter } from 'eventemitter3';
export { default as structuredClone } from '@ungap/structured-clone';
declare global {
    interface ImportMeta {
        env?: Record<string, string | undefined>;
    }
}
export declare function loadEnv(): Record<string, string | undefined>;
export declare const randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
export { Readable } from 'stream-browserify';
export { ReadableStream, ReadableStreamDefaultController as ReadableStreamController, TransformStream, } from 'web-streams-polyfill';
export declare class AsyncLocalStorage {
    context: any;
    active: boolean;
    constructor();
    run(context: any, fn: () => any): any;
    getStore(): any;
    enterWith(context: any): void;
}
export declare function isTracingLoopRunningByDefault(): boolean;
export declare function isBrowserEnvironment(): boolean;
export declare class ReactNativeMCPServerStdio {
    constructor();
}
export declare class ReactNativeMCPServerStreamableHttp {
    constructor();
}
export declare class ReactNativeMCPServerSSE {
    constructor();
}
export { MCPServerStdio, MCPServerStreamableHttp, MCPServerSSE, } from './mcp-server/browser';
declare const exportingClearTimeout: typeof clearTimeout;
export { exportingClearTimeout as clearTimeout };
declare class ReactNativeTimer implements Timer {
    constructor();
    setTimeout(callback: () => void, ms: number): Timeout;
    clearTimeout(timeoutId: Timeout | string | number | undefined): void;
}
declare const timer: ReactNativeTimer;
export { timer };
