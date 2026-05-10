import { Model } from '../core';
import type { ModelRetryAdvice, ModelRetryAdviceRequest, ModelRequest, ModelResponse, ResponseStreamEvent } from '../core';
import OpenAI from 'openai';
export declare const FAKE_ID = "FAKE_ID";
/**
 * A model that uses (or is compatible with) OpenAI's Chat Completions API.
 */
export declare class OpenAIChatCompletionsModel implements Model {
    #private;
    constructor(client: OpenAI, model: string);
    getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | undefined;
    getResponse(request: ModelRequest): Promise<ModelResponse>;
    getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>;
}
