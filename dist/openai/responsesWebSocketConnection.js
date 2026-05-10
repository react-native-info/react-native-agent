import { UserError } from '../core';
import OpenAI from 'openai';
export class ResponsesWebSocketInternalError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ResponsesWebSocketInternalError';
        this.code = code;
    }
}
export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new OpenAI.APIUserAbortError();
    }
}
export async function withAbortSignal(promise, signal) {
    throwIfAborted(signal);
    if (!signal) {
        return promise;
    }
    return await new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(new OpenAI.APIUserAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
export async function withTimeout(promise, timeoutMs, errorMessage) {
    if (typeof timeoutMs !== 'number' ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0) {
        return await promise;
    }
    return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(errorMessage));
        }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timeoutId);
            resolve(value);
        }, (error) => {
            clearTimeout(timeoutId);
            reject(error);
        });
    });
}
export async function webSocketFrameToText(frame) {
    if (typeof frame === 'string') {
        return frame;
    }
    if (typeof Blob !== 'undefined' && frame instanceof Blob) {
        return await frame.text();
    }
    if (frame instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(frame));
    }
    if (ArrayBuffer.isView(frame)) {
        return new TextDecoder().decode(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
    }
    throw new Error('Unsupported websocket frame type for Responses API.');
}
export function shouldWrapNoEventWebSocketError(error) {
    if (error instanceof ResponsesWebSocketInternalError) {
        return (error.code === 'connection_closed_before_opening' ||
            error.code === 'connection_closed_before_terminal_response_event');
    }
    if (!(error instanceof Error)) {
        return false;
    }
    return (error.message === 'Responses websocket connection closed before opening.' ||
        error.message ===
            'Responses websocket connection closed before a terminal response event.');
}
export function isWebSocketNotOpenError(error) {
    if (error instanceof ResponsesWebSocketInternalError) {
        return error.code === 'socket_not_open';
    }
    if (!(error instanceof Error)) {
        return false;
    }
    if (error.message === 'Responses websocket is not open.') {
        return true;
    }
    // Native WebSocket implementations can throw InvalidStateError/DOMException
    // if the socket closes after the readyState check but before send().
    if (error.name === 'InvalidStateError') {
        return true;
    }
    // `ws` throws a plain Error with this message shape for send races.
    if (error.message.startsWith('WebSocket is not open: readyState ')) {
        return true;
    }
    return false;
}
export class ResponsesWebSocketConnection {
    #socket;
    #messages = [];
    #waiters = [];
    #closed = false;
    #error;
    #closedPromise;
    #resolveClosed;
    constructor(socket) {
        this.#socket = socket;
        this.#closedPromise = new Promise((resolve) => {
            this.#resolveClosed = resolve;
        });
        this.#socket.addEventListener('message', this.#onMessage);
        this.#socket.addEventListener('error', this.#onError);
        this.#socket.addEventListener('close', this.#onClose);
    }
    static async connect(url, headers, signal, timeoutMs, timeoutErrorMessage) {
        const WebSocketCtor = globalThis.WebSocket;
        if (!WebSocketCtor) {
            throw new UserError('Responses websocket transport requires a global WebSocket implementation.');
        }
        let socket;
        try {
            socket = new WebSocketCtor(url, { headers });
        }
        catch (error) {
            const wrappedError = new UserError('Responses websocket transport requires a WebSocket implementation that supports custom headers.');
            wrappedError.cause = error;
            throw wrappedError;
        }
        const connection = new ResponsesWebSocketConnection(socket);
        try {
            await connection.waitForOpen(signal, timeoutMs, timeoutErrorMessage);
        }
        catch (error) {
            await connection.close();
            throw error;
        }
        return connection;
    }
    async waitForOpen(signal, timeoutMs, timeoutErrorMessage) {
        if (this.#socket.readyState === this.#socket.OPEN) {
            return;
        }
        if (this.#error) {
            throw this.#error;
        }
        if (this.#closed ||
            this.#socket.readyState === this.#socket.CLOSED ||
            this.#socket.readyState === this.#socket.CLOSING) {
            throw new ResponsesWebSocketInternalError('connection_closed_before_opening', 'Responses websocket connection closed before opening.');
        }
        const openPromise = new Promise((resolve, reject) => {
            const onOpen = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(this.#error ??
                    new Error('Responses websocket connection failed to open.'));
            };
            const onClose = () => {
                cleanup();
                reject(this.#error ??
                    new ResponsesWebSocketInternalError('connection_closed_before_opening', 'Responses websocket connection closed before opening.'));
            };
            const cleanup = () => {
                this.#socket.removeEventListener('open', onOpen);
                this.#socket.removeEventListener('error', onError);
                this.#socket.removeEventListener('close', onClose);
            };
            this.#socket.addEventListener('open', onOpen);
            this.#socket.addEventListener('error', onError);
            this.#socket.addEventListener('close', onClose);
        });
        await withAbortSignal(withTimeout(openPromise, timeoutMs, timeoutErrorMessage ??
            `Responses websocket connection timed out before opening after ${timeoutMs}ms.`), signal);
    }
    async send(data) {
        if (this.#socket.readyState !== this.#socket.OPEN) {
            throw new ResponsesWebSocketInternalError('socket_not_open', 'Responses websocket is not open.');
        }
        this.#socket.send(data);
    }
    isReusable() {
        return (!this.#closed &&
            !this.#error &&
            this.#socket.readyState === this.#socket.OPEN);
    }
    async nextFrame(signal) {
        throwIfAborted(signal);
        return await withAbortSignal(this.#nextFrameInternal(), signal);
    }
    async close() {
        if (!this.#closed) {
            try {
                this.#socket.close();
            }
            catch {
                // Ignore close errors and wait for the socket to settle.
            }
        }
        await this.#closedPromise;
    }
    async #nextFrameInternal() {
        if (this.#messages.length > 0) {
            return this.#messages.shift() ?? null;
        }
        if (this.#error) {
            throw this.#error;
        }
        if (this.#closed) {
            return null;
        }
        return await new Promise((resolve, reject) => {
            this.#waiters.push({ resolve, reject });
        });
    }
    #onMessage = (event) => {
        const data = event.data;
        const waiter = this.#waiters.shift();
        if (waiter) {
            waiter.resolve(data);
            return;
        }
        this.#messages.push(data);
    };
    #onError = (event) => {
        const maybeError = event?.error;
        const maybeMessage = event?.message;
        this.#error =
            maybeError instanceof Error
                ? maybeError
                : new Error(typeof maybeMessage === 'string' && maybeMessage.length > 0
                    ? maybeMessage
                    : 'Responses websocket connection error.');
        const waiters = this.#waiters.splice(0);
        for (const waiter of waiters) {
            waiter.reject(this.#error);
        }
    };
    #onClose = () => {
        this.#closed = true;
        this.#resolveClosed();
        const waiters = this.#waiters.splice(0);
        for (const waiter of waiters) {
            if (this.#error) {
                waiter.reject(this.#error);
            }
            else {
                waiter.resolve(null);
            }
        }
    };
}
//# sourceMappingURL=responsesWebSocketConnection.js.map