import { Runner, type RunConfig } from '../core';
import { OpenAIProvider, type OpenAIProviderOptions } from './openaiProvider';
export type ResponsesWebSocketSessionOptions = {
    /**
     * Options used to construct the session-scoped OpenAI provider.
     */
    providerOptions?: OpenAIProviderOptions;
    /**
     * Runner configuration for the session. modelProvider is controlled by this helper.
     */
    runnerConfig?: Omit<Partial<RunConfig>, 'modelProvider'>;
};
export type ResponsesWebSocketSession = {
    provider: OpenAIProvider;
    runner: Runner;
    run: Runner['run'];
};
/**
 * Runs a callback within a session-scoped Responses API websocket provider/runner and closes the
 * provider afterwards so websocket connections do not keep the process alive.
 */
export declare function withResponsesWebSocketSession<T>(callback: (session: ResponsesWebSocketSession) => Promise<T> | T, options?: ResponsesWebSocketSessionOptions): Promise<T>;
