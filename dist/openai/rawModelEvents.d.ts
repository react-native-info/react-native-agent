import type { RunRawModelStreamEvent, RunStreamEvent, StreamEventGenericItem } from '../core';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import type { ResponseStreamEvent as OpenAIResponseStreamEvent } from 'openai/resources/responses/responses';
export declare const OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE = "openai-responses";
export declare const OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE = "openai-chat-completions";
export type OpenAIRawModelEventSource = typeof OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE | typeof OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE;
type OpenAIRawModelEventData<TSource extends OpenAIRawModelEventSource, TEvent> = Omit<StreamEventGenericItem, 'event' | 'providerData'> & {
    type: 'model';
    event: TEvent;
    providerData: NonNullable<StreamEventGenericItem['providerData']> & {
        rawModelEventSource: TSource;
    };
};
export type OpenAIResponsesRawModelStreamEvent = Omit<RunRawModelStreamEvent, 'data' | 'source'> & {
    source: typeof OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE;
    data: OpenAIRawModelEventData<typeof OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE, OpenAIResponseStreamEvent>;
};
export type OpenAIChatCompletionsRawModelStreamEvent = Omit<RunRawModelStreamEvent, 'data' | 'source'> & {
    source: typeof OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE;
    data: OpenAIRawModelEventData<typeof OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE, ChatCompletionChunk>;
};
export declare function isOpenAIResponsesRawModelStreamEvent(event: RunStreamEvent): event is OpenAIResponsesRawModelStreamEvent;
export declare function isOpenAIChatCompletionsRawModelStreamEvent(event: RunStreamEvent): event is OpenAIChatCompletionsRawModelStreamEvent;
export {};
