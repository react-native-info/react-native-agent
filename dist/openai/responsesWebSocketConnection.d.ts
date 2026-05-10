export type WebSocketMessageValue = string | Blob | ArrayBuffer | ArrayBufferView;
export type ResponsesWebSocketInternalErrorCode = 'connection_closed_before_opening' | 'connection_closed_before_terminal_response_event' | 'socket_not_open';
export declare class ResponsesWebSocketInternalError extends Error {
    readonly code: ResponsesWebSocketInternalErrorCode;
    constructor(code: ResponsesWebSocketInternalErrorCode, message: string);
}
export declare function throwIfAborted(signal: AbortSignal | undefined): void;
export declare function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined, errorMessage: string): Promise<T>;
export declare function webSocketFrameToText(frame: WebSocketMessageValue): Promise<string>;
export declare function shouldWrapNoEventWebSocketError(error: unknown): boolean;
export declare function isWebSocketNotOpenError(error: unknown): boolean;
export declare class ResponsesWebSocketConnection {
    #private;
    constructor(socket: WebSocket);
    static connect(url: string, headers: Record<string, string>, signal: AbortSignal | undefined, timeoutMs?: number, timeoutErrorMessage?: string): Promise<ResponsesWebSocketConnection>;
    waitForOpen(signal: AbortSignal | undefined, timeoutMs?: number, timeoutErrorMessage?: string): Promise<void>;
    send(data: string): Promise<void>;
    isReusable(): boolean;
    nextFrame(signal: AbortSignal | undefined): Promise<WebSocketMessageValue | null>;
    close(): Promise<void>;
}
