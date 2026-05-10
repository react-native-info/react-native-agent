export const OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE = 'openai-responses';
export const OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE = 'openai-chat-completions';
export function isOpenAIResponsesRawModelStreamEvent(event) {
    return (event.type === 'raw_model_stream_event' &&
        event.data.type === 'model' &&
        event.source === OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE);
}
export function isOpenAIChatCompletionsRawModelStreamEvent(event) {
    return (event.type === 'raw_model_stream_event' &&
        event.data.type === 'model' &&
        event.source === OPENAI_CHAT_COMPLETIONS_RAW_MODEL_EVENT_SOURCE);
}
//# sourceMappingURL=rawModelEvents.js.map