import type { ChatCompletionAssistantMessageParam, ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat';
import { SerializedHandoff, SerializedTool, ModelRequest, protocol } from '../core';
export declare function convertToolChoice(toolChoice: 'auto' | 'required' | 'none' | (string & {}) | undefined | null): ChatCompletionToolChoiceOption | undefined;
export declare function getCompatibleToolChoice(toolChoice: 'auto' | 'required' | 'none' | (string & {}) | undefined | null, tools: ChatCompletionTool[]): ChatCompletionToolChoiceOption | undefined;
export declare function extractAllAssistantContent(content: protocol.AssistantMessageItem['content']): string | ChatCompletionAssistantMessageParam['content'];
export declare function extractAllUserContent(content: protocol.UserMessageItem['content']): string | ChatCompletionContentPart[];
export declare function itemsToMessages(items: ModelRequest['input']): ChatCompletionMessageParam[];
export declare function toolToOpenAI(tool: SerializedTool): ChatCompletionTool;
export declare function convertHandoffTool(handoff: SerializedHandoff): ChatCompletionTool;
