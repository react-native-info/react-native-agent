import { Model, ModelProvider } from '../core';
import OpenAI from 'openai';
/**
 * Options for OpenAIProvider.
 */
export type OpenAIProviderOptions = {
    apiKey?: string;
    baseURL?: string;
    websocketBaseURL?: string;
    cacheResponsesWebSocketModels?: boolean;
    organization?: string;
    project?: string;
    useResponses?: boolean;
    useResponsesWebSocket?: boolean;
    openAIClient?: OpenAI;
};
/**
 * The provider of OpenAI's models (or Chat Completions compatible ones)
 */
export declare class OpenAIProvider implements ModelProvider {
    #private;
    constructor(options?: OpenAIProviderOptions);
    getModel(modelName?: string | undefined): Promise<Model>;
    /**
     * Closes cached model wrappers (for example websocket-backed responses models) and clears cache.
     */
    close(): Promise<void>;
}
