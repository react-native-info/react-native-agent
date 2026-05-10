import { loadEnv } from '../core';
import METADATA from './metadata';
export const DEFAULT_OPENAI_API = 'responses';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
export const DEFAULT_OPENAI_RESPONSES_TRANSPORT = 'http';
let _defaultOpenAIAPI = DEFAULT_OPENAI_API;
let _defaultOpenAIResponsesTransport = DEFAULT_OPENAI_RESPONSES_TRANSPORT;
let _defaultOpenAIClient;
let _defaultOpenAIKey = undefined;
let _defaultTracingApiKey = undefined;
export function setTracingExportApiKey(key) {
    _defaultTracingApiKey = key;
}
export function getTracingExportApiKey() {
    return _defaultTracingApiKey ?? loadEnv().OPENAI_API_KEY;
}
export function shouldUseResponsesByDefault() {
    return _defaultOpenAIAPI === 'responses';
}
export function shouldUseResponsesWebSocketByDefault() {
    return _defaultOpenAIResponsesTransport === 'websocket';
}
export function setOpenAIAPI(value) {
    _defaultOpenAIAPI = value;
}
export function setOpenAIResponsesTransport(value) {
    _defaultOpenAIResponsesTransport = value;
}
export function setDefaultOpenAIClient(client) {
    _defaultOpenAIClient = client;
}
export function getDefaultOpenAIClient() {
    return _defaultOpenAIClient;
}
export function setDefaultOpenAIKey(key) {
    _defaultOpenAIKey = key;
}
export function getDefaultOpenAIKey() {
    return _defaultOpenAIKey ?? loadEnv().OPENAI_API_KEY;
}
export function getDefaultOpenAIWebSocketBaseURL() {
    return loadEnv().OPENAI_WEBSOCKET_BASE_URL;
}
export const HEADERS = {
    'User-Agent': `Agents/JavaScript ${METADATA.version}`,
};
//# sourceMappingURL=defaults.js.map