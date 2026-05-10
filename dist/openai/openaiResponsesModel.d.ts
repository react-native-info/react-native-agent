import { Model, protocol } from '../core';
import type { ModelRetryAdvice, ModelRetryAdviceRequest, SerializedTool, ModelRequest, ModelResponse, ModelSettingsToolChoice, ResponseStreamEvent } from '../core';
import OpenAI from 'openai';
import { ToolChoiceFunction, ToolChoiceOptions, ToolChoiceTypes } from 'openai/resources/responses/responses';
import { headerAccumulatorToSDKHeaders } from './responsesTransportUtils';
type ToolChoice = ToolChoiceOptions | ToolChoiceTypes | {
    type: 'web_search';
} | {
    type: 'tool_search';
} | ToolChoiceFunction;
type ResponsesCreateRequestSDKHeaders = ReturnType<typeof headerAccumulatorToSDKHeaders>;
type BuiltResponsesCreateRequest = {
    requestData: Record<string, any>;
    sdkRequestHeaders: ResponsesCreateRequestSDKHeaders;
    signal: AbortSignal | undefined;
    transportExtraHeaders?: Record<string, unknown>;
    transportExtraQuery?: Record<string, unknown>;
};
type ResponseOutputItemWithFunctionResult = OpenAI.Responses.ResponseOutputItem | (OpenAI.Responses.ResponseFunctionToolCallOutputItem & {
    name?: string;
    function_name?: string;
    namespace?: string;
}) | OpenAI.Responses.ResponseToolSearchCall | OpenAI.Responses.ResponseToolSearchOutputItem;
type ResponsesTool = OpenAI.Responses.Tool | Record<string, any>;
declare function getToolChoice(toolChoice?: ModelSettingsToolChoice, options?: {
    tools?: Array<{
        type?: unknown;
    }>;
    model?: string;
    allowPromptSuppliedComputerTool?: boolean;
}): ToolChoice | undefined;
declare function converTool<_TContext = unknown>(tool: SerializedTool, options?: {
    usePreviewComputerTool?: boolean;
}): {
    tool: ResponsesTool;
    include?: OpenAI.Responses.ResponseIncludable[];
};
declare function getInputItems(input: ModelRequest['input']): OpenAI.Responses.ResponseInputItem[];
declare function convertToOutputItem(items: ResponseOutputItemWithFunctionResult[]): protocol.OutputModelItem[];
export { getToolChoice, converTool, getInputItems, convertToOutputItem };
/**
 * Model implementation that uses OpenAI's Responses API to generate responses.
 */
export declare class OpenAIResponsesModel implements Model {
    protected readonly _client: OpenAI;
    protected readonly _model: string;
    constructor(client: OpenAI, model: string);
    getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | undefined;
    /**
     * @internal
     */
    protected _fetchResponse(request: ModelRequest, stream: true): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>;
    protected _fetchResponse(request: ModelRequest, stream: false): Promise<OpenAI.Responses.Response>;
    protected _buildResponsesCreateRequest(request: ModelRequest, stream: boolean): BuiltResponsesCreateRequest;
    /**
     * Get a response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns A promise that resolves to the response from the model.
     */
    getResponse(request: ModelRequest): Promise<ModelResponse>;
    /**
     * Get a streamed response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns An async iterable of the response from the model.
     */
    getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>;
}
export type OpenAIResponsesWSModelOptions = {
    websocketBaseURL?: string;
    reuseConnection?: boolean;
};
/**
 * Model implementation that uses the OpenAI Responses API over a websocket transport.
 *
 * @see {@link https://developers.openai.com/api/docs/guides/websocket-mode}
 */
export declare class OpenAIResponsesWSModel extends OpenAIResponsesModel {
    #private;
    constructor(client: OpenAI, model: string, options?: OpenAIResponsesWSModelOptions);
    getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | undefined;
    /**
     * @internal
     */
    protected _fetchResponse(request: ModelRequest, stream: true): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>;
    protected _fetchResponse(request: ModelRequest, stream: false): Promise<OpenAI.Responses.Response>;
    close(): Promise<void>;
}
