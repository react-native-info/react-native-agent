import { RequestUsage, Usage, withResponseSpan, createResponseSpan, setCurrentSpan, resetCurrentSpan, UserError, } from '../core';
import OpenAI from 'openai';
import logger from './logger';
import { OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE } from './rawModelEvents';
import { getOpenAIRetryAdvice } from './retryAdvice';
import { z } from 'zod';
import { HEADERS } from './defaults';
import { ResponsesWebSocketConnection, ResponsesWebSocketInternalError, isWebSocketNotOpenError, shouldWrapNoEventWebSocketError, throwIfAborted, webSocketFrameToText, withAbortSignal, withTimeout, } from './responsesWebSocketConnection';
import { applyHeadersToAccumulator, createHeaderAccumulator, ensureResponsesWebSocketPath, headerAccumulatorToRecord, headerAccumulatorToSDKHeaders, mergeQueryParamsIntoURL, splitResponsesTransportOverrides, } from './responsesTransportUtils';
import { CodeInterpreterStatus, FileSearchStatus, ImageGenerationStatus, WebSearchStatus, } from './tools';
import { camelOrSnakeToSnakeCase, getSnakeCasedProviderDataWithoutReservedKeys, } from './utils/providerData';
import { encodeUint8ArrayToBase64, getToolSearchExecution, getToolSearchProviderCallId, } from '../core';
/**
 * Tool search outputs are replayed through agents-core protocol items, which use camelCase
 * field names, while the Responses API wire shape uses snake_case. Keep this codec even with
 * first-class upstream types because the local protocol still normalizes these payloads.
 */
function toOpenAIToolSearchOutputToolPayload(tool, _withinNamespace = false) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        return tool;
    }
    if (tool.type === 'tool_reference' && typeof tool.functionName === 'string') {
        return {
            type: 'tool_reference',
            function_name: tool.functionName,
            ...(typeof tool.namespace === 'string'
                ? { namespace: tool.namespace }
                : {}),
        };
    }
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
        return {
            ...tool,
            tools: tool.tools.map((entry) => toOpenAIToolSearchOutputToolPayload(entry, true)),
        };
    }
    if (tool.type === 'function') {
        const { deferLoading, ...rest } = tool;
        return {
            ...rest,
            ...(typeof deferLoading === 'boolean'
                ? { defer_loading: deferLoading }
                : {}),
        };
    }
    return tool;
}
function fromOpenAIToolSearchOutputToolPayload(tool, _withinNamespace = false) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        return tool;
    }
    if (tool.type === 'tool_reference' &&
        typeof tool.function_name === 'string') {
        return {
            type: 'tool_reference',
            functionName: tool.function_name,
            ...(typeof tool.namespace === 'string'
                ? { namespace: tool.namespace }
                : {}),
        };
    }
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
        return {
            ...tool,
            tools: tool.tools.map((entry) => fromOpenAIToolSearchOutputToolPayload(entry, true)),
        };
    }
    if (tool.type === 'function') {
        const { defer_loading, ...rest } = tool;
        return {
            ...rest,
            ...(typeof defer_loading === 'boolean'
                ? { deferLoading: defer_loading }
                : {}),
        };
    }
    return tool;
}
function isNeverSentWebSocketError(error) {
    if (isWebSocketNotOpenError(error)) {
        return true;
    }
    const errorCause = error instanceof Error
        ? error.cause
        : undefined;
    if (error instanceof ResponsesWebSocketInternalError &&
        error.code === 'connection_closed_before_opening') {
        return true;
    }
    if (errorCause instanceof ResponsesWebSocketInternalError &&
        errorCause.code === 'connection_closed_before_opening') {
        return true;
    }
    return false;
}
function isAmbiguousWebSocketReplayError(error) {
    if (error instanceof ResponsesWebSocketInternalError &&
        error.code === 'connection_closed_before_terminal_response_event') {
        return true;
    }
    const errorCause = error instanceof Error
        ? error.cause
        : undefined;
    return (errorCause instanceof ResponsesWebSocketInternalError &&
        errorCause.code === 'connection_closed_before_terminal_response_event');
}
function hasSerializedComputerDisplayMetadata(tool) {
    return (typeof tool.environment === 'string' &&
        Array.isArray(tool.dimensions) &&
        tool.dimensions.length === 2 &&
        tool.dimensions.every((value) => typeof value === 'number'));
}
const HostedToolChoice = z.enum([
    'file_search',
    'web_search',
    'web_search_preview',
    'code_interpreter',
    'image_generation',
    'mcp',
    // Specialized local tools
    'shell',
    'apply_patch',
]);
const DefaultToolChoice = z.enum(['auto', 'required', 'none']);
const BuiltinComputerToolChoice = z.enum([
    'computer',
    'computer_use',
    'computer_use_preview',
]);
function getToolChoice(toolChoice, options) {
    if (typeof toolChoice === 'undefined') {
        return undefined;
    }
    const resultDefaultCheck = DefaultToolChoice.safeParse(toolChoice);
    if (resultDefaultCheck.success) {
        return resultDefaultCheck.data;
    }
    const builtinComputerToolChoice = BuiltinComputerToolChoice.safeParse(toolChoice);
    if (builtinComputerToolChoice.success) {
        if (hasBuiltinComputerTool(options?.tools) ||
            options?.allowPromptSuppliedComputerTool === true) {
            return getBuiltinComputerToolChoice(builtinComputerToolChoice.data, {
                model: options?.model,
            });
        }
        if (builtinComputerToolChoice.data === 'computer_use_preview') {
            return { type: 'computer_use_preview' };
        }
        return { type: 'function', name: builtinComputerToolChoice.data };
    }
    const result = HostedToolChoice.safeParse(toolChoice);
    if (result.success) {
        return { type: result.data };
    }
    return { type: 'function', name: toolChoice };
}
function normalizeToolSearchStatus(status) {
    return status === 'in_progress' ||
        status === 'completed' ||
        status === 'incomplete'
        ? status
        : null;
}
function hasBuiltinComputerTool(tools) {
    return (tools ?? []).some((tool) => tool.type === 'computer' ||
        tool.type === 'computer_use' ||
        tool.type === 'computer_use_preview');
}
function isPreviewComputerModel(model) {
    return typeof model === 'string' && model.startsWith('computer-use-preview');
}
function shouldUsePreviewComputerTool(options) {
    if (isPreviewComputerModel(options?.model)) {
        return true;
    }
    if (typeof options?.model === 'string') {
        return false;
    }
    if (options?.toolChoice === 'computer' ||
        options?.toolChoice === 'computer_use') {
        return false;
    }
    return true;
}
function getBuiltinComputerToolChoice(toolChoice, options) {
    if (shouldUsePreviewComputerTool({
        model: options?.model,
        toolChoice,
    })) {
        return { type: 'computer_use_preview' };
    }
    if (toolChoice === 'computer_use') {
        return { type: 'computer_use' };
    }
    return { type: 'computer' };
}
function isBuiltinComputerToolType(type) {
    return (type === 'computer' ||
        type === 'computer_use' ||
        type === 'computer_use_preview');
}
function isCompatibleBuiltinComputerToolChoice(toolChoiceType, toolType) {
    if (!isBuiltinComputerToolType(toolChoiceType)) {
        return false;
    }
    if (toolChoiceType === 'computer_use_preview') {
        return toolType === 'computer_use_preview';
    }
    return toolType === 'computer';
}
function isToolChoiceAvailable(toolChoice, tools) {
    if (toolChoice === 'auto' || toolChoice === 'none') {
        return true;
    }
    if (toolChoice === 'required') {
        return tools.length > 0;
    }
    if (toolChoice.type === 'function') {
        return hasFunctionToolChoiceName(toolChoice.name, tools);
    }
    return tools.some((tool) => isCompatibleBuiltinComputerToolChoice(toolChoice.type, tool.type)
        ? true
        : tool.type === toolChoice.type);
}
function hasFunctionToolChoiceName(toolChoiceName, tools, namespacePrefix) {
    return (findFunctionToolChoice(toolChoiceName, tools, namespacePrefix) !== undefined);
}
function findFunctionToolChoice(toolChoiceName, tools, namespacePrefix) {
    for (const tool of tools) {
        if (isNamedFunctionTool(tool)) {
            const qualifiedName = namespacePrefix
                ? `${namespacePrefix}.${tool.name}`
                : tool.name;
            if (toolChoiceName === qualifiedName) {
                return tool;
            }
            continue;
        }
        if (isNamespaceTool(tool)) {
            const nestedNamespace = namespacePrefix
                ? `${namespacePrefix}.${tool.name}`
                : tool.name;
            const matchedTool = findFunctionToolChoice(toolChoiceName, tool.tools, nestedNamespace);
            if (matchedTool) {
                return matchedTool;
            }
        }
    }
    return undefined;
}
function collectAvailableToolChoiceNames(tools, namespacePrefix) {
    const availableToolChoices = [];
    for (const tool of tools) {
        if (isNamedFunctionTool(tool)) {
            availableToolChoices.push(namespacePrefix ? `${namespacePrefix}.${tool.name}` : tool.name);
            continue;
        }
        if (isNamespaceTool(tool)) {
            const nestedNamespace = namespacePrefix
                ? `${namespacePrefix}.${tool.name}`
                : tool.name;
            availableToolChoices.push(...collectAvailableToolChoiceNames(tool.tools, nestedNamespace));
            continue;
        }
        availableToolChoices.push(tool.type);
    }
    return availableToolChoices;
}
function isNamedFunctionTool(tool) {
    return (tool.type === 'function' &&
        typeof tool.name === 'string');
}
function isNamespaceTool(tool) {
    const candidate = tool;
    return (tool.type === 'namespace' &&
        typeof candidate.name === 'string' &&
        Array.isArray(candidate.tools));
}
function getExtraBodyToolsForToolChoiceValidation(extraBody) {
    if (!extraBody || !Array.isArray(extraBody.tools)) {
        return [];
    }
    return extraBody.tools;
}
function assertSupportedToolChoice(toolChoice, tools, options) {
    const allowPromptSuppliedTools = options?.allowPromptSuppliedTools === true;
    if (!toolChoice ||
        toolChoice === 'auto' ||
        toolChoice === 'required' ||
        toolChoice === 'none' ||
        toolChoice.type !== 'function') {
        return;
    }
    const matchedFunctionTool = findFunctionToolChoice(toolChoice.name, tools);
    if (!matchedFunctionTool &&
        allowPromptSuppliedTools &&
        toolChoice.name !== 'tool_search') {
        return;
    }
    if (matchedFunctionTool
        ?.defer_loading === true) {
        throw new UserError(`modelSettings.toolChoice="${toolChoice.name}" cannot force a deferred function tool in Responses. Use "auto" so tool_search can load it.`);
    }
    if (toolChoice.name === 'tool_search' &&
        !hasFunctionToolChoiceName(toolChoice.name, tools)) {
        throw new UserError('modelSettings.toolChoice="tool_search" is only supported for a custom function named "tool_search". Responses does not support forcing the built-in tool_search tool. Use "auto" instead.');
    }
}
function getCompatibleToolChoice(toolChoice, tools, options) {
    const allowPromptSuppliedTools = options?.allowPromptSuppliedTools === true;
    if (typeof toolChoice === 'undefined') {
        return undefined;
    }
    if (isToolChoiceAvailable(toolChoice, tools) || allowPromptSuppliedTools) {
        return toolChoice;
    }
    const availableToolChoices = [
        ...new Set(collectAvailableToolChoiceNames(tools)),
    ];
    const availableToolChoicesMessage = availableToolChoices.length > 0
        ? ` Available tools: ${availableToolChoices.join(', ')}.`
        : ' No tools are available in the outgoing Responses request.';
    if (toolChoice === 'required') {
        throw new UserError(`modelSettings.toolChoice="required" requires at least one available tool in the outgoing Responses request.${availableToolChoicesMessage}`);
    }
    if (toolChoice === 'auto' || toolChoice === 'none') {
        throw new Error(`Unexpected unavailable tool choice: ${JSON.stringify(toolChoice)}`);
    }
    if (toolChoice.type === 'function') {
        throw new UserError(`modelSettings.toolChoice="${toolChoice.name}" does not match any available tool in the outgoing Responses request.${availableToolChoicesMessage}`);
    }
    throw new UserError(`modelSettings.toolChoice="${toolChoice.type}" is unavailable in the outgoing Responses request.${availableToolChoicesMessage}`);
}
function getResponseFormat(outputType, otherProperties) {
    if (outputType === 'text') {
        return otherProperties;
    }
    return {
        ...otherProperties,
        format: outputType,
    };
}
function normalizeFunctionCallOutputForRequest(output) {
    if (typeof output === 'string') {
        return output;
    }
    if (Array.isArray(output)) {
        return output.map(convertStructuredOutputToRequestItem);
    }
    if (isRecord(output) && typeof output.type === 'string') {
        if (output.type === 'text' && typeof output.text === 'string') {
            return output.text;
        }
        if (output.type === 'image' || output.type === 'file') {
            const structuredItems = convertLegacyToolOutputContent(output);
            return structuredItems.map(convertStructuredOutputToRequestItem);
        }
    }
    return String(output);
}
/**
 * Older tool integrations (and the Python SDK) still return their own `ToolOutput*` objects.
 * Translate those into the protocol `input_*` structures so the rest of the pipeline can stay
 * agnostic about who produced the data.
 */
function convertLegacyToolOutputContent(output) {
    if (output.type === 'text') {
        const structured = {
            type: 'input_text',
            text: output.text,
        };
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    if (output.type === 'image') {
        const structured = {
            type: 'input_image',
        };
        if (output.detail) {
            structured.detail = output.detail;
        }
        const legacyImageUrl = output.imageUrl;
        const legacyFileId = output.fileId;
        const dataValue = output.data;
        const topLevelInlineMediaType = getImageInlineMediaType(output);
        if (typeof output.image === 'string' && output.image.length > 0) {
            structured.image = output.image;
        }
        else if (isRecord(output.image)) {
            const imageObj = output.image;
            const inlineMediaType = getImageInlineMediaType(imageObj) ?? topLevelInlineMediaType;
            if (typeof imageObj.url === 'string' && imageObj.url.length > 0) {
                structured.image = imageObj.url;
            }
            else if (typeof imageObj.data === 'string' &&
                imageObj.data.length > 0) {
                structured.image = formatInlineData(imageObj.data, inlineMediaType);
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                structured.image = formatInlineData(imageObj.data, inlineMediaType);
            }
            else {
                const referencedId = (typeof imageObj.fileId === 'string' &&
                    imageObj.fileId.length > 0 &&
                    imageObj.fileId) ||
                    (typeof imageObj.id === 'string' && imageObj.id.length > 0
                        ? imageObj.id
                        : undefined);
                if (referencedId) {
                    structured.image = { id: referencedId };
                }
            }
        }
        else if (typeof legacyImageUrl === 'string' &&
            legacyImageUrl.length > 0) {
            structured.image = legacyImageUrl;
        }
        else if (typeof legacyFileId === 'string' && legacyFileId.length > 0) {
            structured.image = { id: legacyFileId };
        }
        else {
            let base64Data;
            if (typeof dataValue === 'string' && dataValue.length > 0) {
                base64Data = dataValue;
            }
            else if (dataValue instanceof Uint8Array && dataValue.length > 0) {
                base64Data = encodeUint8ArrayToBase64(dataValue);
            }
            if (base64Data) {
                structured.image = formatInlineData(base64Data, topLevelInlineMediaType);
            }
        }
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    if (output.type === 'file') {
        const structured = {
            type: 'input_file',
        };
        const fileValue = output.file ?? output.file;
        if (typeof fileValue === 'string') {
            structured.file = fileValue;
        }
        else if (isRecord(fileValue)) {
            if (typeof fileValue.data === 'string' && fileValue.data.length > 0) {
                structured.file = formatInlineData(fileValue.data, fileValue.mediaType ?? 'text/plain');
            }
            else if (fileValue.data instanceof Uint8Array &&
                fileValue.data.length > 0) {
                structured.file = formatInlineData(fileValue.data, fileValue.mediaType ?? 'text/plain');
            }
            else if (typeof fileValue.url === 'string' &&
                fileValue.url.length > 0) {
                structured.file = { url: fileValue.url };
            }
            else {
                const referencedId = (typeof fileValue.id === 'string' &&
                    fileValue.id.length > 0 &&
                    fileValue.id) ||
                    (typeof fileValue.fileId === 'string' &&
                        fileValue.fileId.length > 0
                        ? fileValue.fileId
                        : undefined);
                if (referencedId) {
                    structured.file = { id: referencedId };
                }
            }
            if (typeof fileValue.filename === 'string' &&
                fileValue.filename.length > 0) {
                structured.filename = fileValue.filename;
            }
        }
        if (!structured.file) {
            const legacy = normalizeLegacyFileFromOutput(output);
            if (legacy.file) {
                structured.file = legacy.file;
            }
            if (legacy.filename) {
                structured.filename = legacy.filename;
            }
        }
        if (output.providerData) {
            structured.providerData = output.providerData;
        }
        return [structured];
    }
    throw new UserError(`Unsupported tool output type: ${JSON.stringify(output)}`);
}
/**
 * Converts the protocol-level structured output into the exact wire format expected by the
 * Responses API. Be careful to keep the snake_case property names the service requires here.
 */
function convertStructuredOutputToRequestItem(item) {
    if (item.type === 'input_text') {
        return {
            type: 'input_text',
            text: item.text,
        };
    }
    if (item.type === 'input_image') {
        const result = { type: 'input_image' };
        const imageValue = item.image ?? item.imageUrl;
        if (typeof imageValue === 'string') {
            result.image_url = imageValue;
        }
        else if (isRecord(imageValue) && typeof imageValue.id === 'string') {
            result.file_id = imageValue.id;
        }
        const legacyFileId = item.fileId;
        if (typeof legacyFileId === 'string') {
            result.file_id = legacyFileId;
        }
        if (item.detail) {
            result.detail = item.detail;
        }
        return result;
    }
    if (item.type === 'input_file') {
        const result = { type: 'input_file' };
        if (typeof item.file === 'string') {
            // String file values are treated as inline data or URLs; use { id: "file_..." } for OpenAI file IDs.
            const value = item.file.trim();
            if (value.startsWith('data:')) {
                result.file_data = value;
            }
            else if (value.startsWith('http://') || value.startsWith('https://')) {
                result.file_url = value;
            }
            else if (/^[A-Za-z0-9+/=]+$/.test(value)) {
                result.file_data = value;
            }
            else {
                result.file_url = value;
            }
        }
        else if (item.file &&
            typeof item.file === 'object' &&
            'id' in item.file &&
            typeof item.file.id === 'string') {
            result.file_id = item.file.id;
        }
        else if (item.file &&
            typeof item.file === 'object' &&
            'url' in item.file &&
            typeof item.file.url === 'string') {
            result.file_url = item.file.url;
        }
        const legacyFileData = item.fileData;
        if (typeof legacyFileData === 'string') {
            result.file_data = legacyFileData;
        }
        const legacyFileUrl = item.fileUrl;
        if (typeof legacyFileUrl === 'string') {
            result.file_url = legacyFileUrl;
        }
        const legacyFileId = item.fileId;
        if (typeof legacyFileId === 'string') {
            result.file_id = legacyFileId;
        }
        if (item.filename) {
            result.filename = item.filename;
        }
        return result;
    }
    throw new UserError(`Unsupported structured tool output: ${JSON.stringify(item)}`);
}
function convertResponseFunctionCallOutputItemToStructured(item) {
    if (item.type === 'input_text') {
        return {
            type: 'input_text',
            text: item.text,
        };
    }
    if (item.type === 'input_image') {
        const structured = { type: 'input_image' };
        if (typeof item.image_url === 'string' && item.image_url.length > 0) {
            structured.image = item.image_url;
        }
        else if (typeof item.file_id === 'string' && item.file_id.length > 0) {
            structured.image = { id: item.file_id };
        }
        else {
            // As of 2025-10-30, conversations retrieval API may not include
            // data url in image_url property; so skipping this pattern
            logger.debug(`Skipped the "input_image" output item from a tool call result because the OpenAI Conversations API response didn't include the required property (image_url or file_id).`);
            return null;
        }
        if (item.detail) {
            structured.detail = item.detail;
        }
        return structured;
    }
    if (item.type === 'input_file') {
        const structured = { type: 'input_file' };
        if (typeof item.file_id === 'string' && item.file_id.length > 0) {
            structured.file = { id: item.file_id };
        }
        else if (typeof item.file_url === 'string' && item.file_url.length > 0) {
            structured.file = { url: item.file_url };
        }
        else if (typeof item.file_data === 'string' &&
            item.file_data.length > 0) {
            structured.file = item.file_data;
        }
        if (item.filename) {
            structured.filename = item.filename;
        }
        return structured;
    }
    const exhaustive = item;
    throw new UserError(`Unsupported structured tool output: ${JSON.stringify(exhaustive)}`);
}
function convertFunctionCallOutputToProtocol(output) {
    if (typeof output === 'string') {
        return output;
    }
    if (Array.isArray(output)) {
        return output
            .map(convertResponseFunctionCallOutputItemToStructured)
            .filter((s) => s !== null);
    }
    return '';
}
function normalizeLegacyFileFromOutput(value) {
    const filename = typeof value.filename === 'string' && value.filename.length > 0
        ? value.filename
        : undefined;
    const referencedId = typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : typeof value.fileId === 'string' && value.fileId.length > 0
            ? value.fileId
            : undefined;
    if (referencedId) {
        return { file: { id: referencedId }, filename };
    }
    if (typeof value.fileUrl === 'string' && value.fileUrl.length > 0) {
        return { file: { url: value.fileUrl }, filename };
    }
    if (typeof value.fileData === 'string' && value.fileData.length > 0) {
        return {
            file: formatInlineData(value.fileData, value.mediaType ?? 'text/plain'),
            filename,
        };
    }
    if (value.fileData instanceof Uint8Array && value.fileData.length > 0) {
        return {
            file: formatInlineData(value.fileData, value.mediaType ?? 'text/plain'),
            filename,
        };
    }
    return {};
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function getShellCallProviderDataForInput(providerData) {
    const normalized = camelOrSnakeToSnakeCase(providerData);
    if (!isRecord(normalized)) {
        return {};
    }
    const environment = normalized.environment;
    if (!isRecord(environment)) {
        return {};
    }
    return {
        environment: environment,
    };
}
function getImageInlineMediaType(source) {
    if (typeof source.mediaType === 'string' && source.mediaType.length > 0) {
        return source.mediaType;
    }
    if (typeof source.mimeType === 'string' &&
        source.mimeType.length > 0) {
        return source.mimeType;
    }
    return undefined;
}
function formatInlineData(data, mediaType) {
    if (typeof data === 'string' && data.startsWith('data:')) {
        return data;
    }
    const base64 = typeof data === 'string' ? data : encodeUint8ArrayToBase64(data);
    return mediaType ? `data:${mediaType};base64,${base64}` : base64;
}
function toOpenAIShellSkill(skill) {
    if (skill.type === 'skill_reference') {
        const skillId = skill.skillId;
        if (typeof skillId !== 'string' || skillId.length === 0) {
            throw new UserError('shell skill_reference requires skillId.');
        }
        return {
            type: 'skill_reference',
            skill_id: skillId,
            version: skill.version,
        };
    }
    if (skill.type === 'inline') {
        if (!skill.source) {
            throw new UserError('shell inline skill requires a source.');
        }
        const mediaType = skill.source.mediaType;
        if (mediaType !== 'application/zip') {
            throw new UserError('shell inline skill source.mediaType must be application/zip.');
        }
        if (typeof skill.source.data !== 'string' ||
            skill.source.data.length === 0) {
            throw new UserError('shell inline skill source.data is required.');
        }
        if (typeof skill.name !== 'string' || skill.name.length === 0) {
            throw new UserError('shell inline skill requires name.');
        }
        if (typeof skill.description !== 'string' ||
            skill.description.length === 0) {
            throw new UserError('shell inline skill requires description.');
        }
        return {
            type: 'inline',
            name: skill.name,
            description: skill.description,
            source: {
                type: 'base64',
                media_type: 'application/zip',
                data: skill.source.data,
            },
        };
    }
    throw new UserError(`Unsupported shell skill type: ${String(skill.type)}`);
}
function toOpenAIShellNetworkPolicy(policy) {
    if (!policy) {
        return undefined;
    }
    if (policy.type === 'disabled') {
        return { type: 'disabled' };
    }
    if (policy.type === 'allowlist') {
        if (!Array.isArray(policy.allowedDomains)) {
            throw new UserError('shell allowlist networkPolicy requires allowedDomains.');
        }
        const allowedDomains = policy.allowedDomains.filter((domain) => typeof domain === 'string' && domain.length > 0);
        const domainSecrets = policy.domainSecrets?.map((secret) => ({
            domain: secret.domain,
            name: secret.name,
            value: secret.value,
        }));
        return {
            type: 'allowlist',
            allowed_domains: allowedDomains,
            domain_secrets: domainSecrets,
        };
    }
    throw new UserError(`Unsupported shell networkPolicy type: ${String(policy.type)}`);
}
function toOpenAIShellEnvironment(environment) {
    if (!environment) {
        return { type: 'local' };
    }
    if (environment.type === 'local') {
        const localSkills = environment.skills?.map((skill) => {
            if (typeof skill.name !== 'string' ||
                typeof skill.description !== 'string' ||
                typeof skill.path !== 'string') {
                throw new UserError('Local shell skill requires name, description, and path.');
            }
            return {
                name: skill.name,
                description: skill.description,
                path: skill.path,
            };
        });
        return {
            type: 'local',
            skills: localSkills,
        };
    }
    if (environment.type === 'container_auto') {
        const skills = environment.skills?.map(toOpenAIShellSkill);
        return {
            type: 'container_auto',
            file_ids: environment.fileIds,
            memory_limit: environment.memoryLimit,
            network_policy: toOpenAIShellNetworkPolicy(environment.networkPolicy),
            skills,
        };
    }
    if (environment.type === 'container_reference') {
        const containerId = environment.containerId;
        if (typeof containerId !== 'string' || containerId.length === 0) {
            throw new UserError('shell container_reference environment requires containerId.');
        }
        return {
            type: 'container_reference',
            container_id: containerId,
        };
    }
    throw new UserError(`Unsupported shell environment type: ${String(environment.type)}`);
}
function getTools(tools, handoffs, options) {
    const openaiTools = [];
    const include = [];
    const namespaceStateByName = new Map();
    let hasDeferredSearchableTool = false;
    let hasToolSearch = false;
    const usePreviewComputerTool = shouldUsePreviewComputerTool({
        model: options?.model,
        toolChoice: options?.toolChoice,
    });
    for (const tool of tools) {
        if (tool.type === 'function') {
            const isDeferredFunction = tool.deferLoading === true;
            hasDeferredSearchableTool ||= isDeferredFunction;
            const namespaceName = typeof tool.namespace === 'string' ? tool.namespace.trim() : '';
            if (namespaceName.length > 0) {
                const namespaceDescription = typeof tool.namespaceDescription === 'string'
                    ? tool.namespaceDescription.trim()
                    : '';
                if (namespaceDescription.length === 0) {
                    throw new UserError(`All tools in namespace "${namespaceName}" must provide a non-empty description.`);
                }
                let namespaceState = namespaceStateByName.get(namespaceName);
                if (!namespaceState) {
                    namespaceState = {
                        index: openaiTools.length,
                        description: namespaceDescription,
                        functionNames: new Set(),
                        tools: [],
                    };
                    namespaceStateByName.set(namespaceName, namespaceState);
                    openaiTools.push({});
                }
                else if (namespaceState.description !== namespaceDescription) {
                    throw new UserError(`All tools in namespace "${namespaceName}" must share the same description.`);
                }
                const { tool: openaiTool, include: openaiIncludes } = converTool(tool, {
                    usePreviewComputerTool,
                });
                if (namespaceState.functionNames.has(tool.name)) {
                    throw new UserError(`Namespace "${namespaceName}" cannot contain duplicate function tool name "${tool.name}".`);
                }
                namespaceState.functionNames.add(tool.name);
                namespaceState.tools.push(openaiTool);
                if (openaiIncludes && openaiIncludes.length > 0) {
                    for (const item of openaiIncludes) {
                        include.push(item);
                    }
                }
                continue;
            }
        }
        if (tool.type === 'hosted_tool' &&
            tool.providerData?.type === 'tool_search') {
            hasToolSearch = true;
        }
        if (tool.type === 'hosted_tool' &&
            tool.providerData?.type === 'mcp' &&
            tool.providerData.defer_loading === true) {
            hasDeferredSearchableTool = true;
        }
        const { tool: openaiTool, include: openaiIncludes } = converTool(tool, {
            usePreviewComputerTool,
        });
        openaiTools.push(openaiTool);
        if (openaiIncludes && openaiIncludes.length > 0) {
            for (const item of openaiIncludes) {
                include.push(item);
            }
        }
    }
    if (hasDeferredSearchableTool && !hasToolSearch) {
        throw new UserError('Deferred function tools and hosted MCP tools with deferLoading: true require toolSearchTool() in the same request.');
    }
    for (const [namespaceName, namespaceState,] of namespaceStateByName.entries()) {
        openaiTools[namespaceState.index] = {
            type: 'namespace',
            name: namespaceName,
            description: namespaceState.description,
            tools: namespaceState.tools,
        };
    }
    return {
        tools: [...openaiTools, ...handoffs.map(getHandoffTool)],
        include,
    };
}
function converTool(tool, options) {
    if (tool.type === 'function') {
        const openaiTool = {
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict,
        };
        if (tool.deferLoading) {
            openaiTool.defer_loading = true;
        }
        return {
            tool: openaiTool,
            include: undefined,
        };
    }
    else if (tool.type === 'computer') {
        if (options?.usePreviewComputerTool) {
            if (!hasSerializedComputerDisplayMetadata(tool)) {
                throw new UserError('Preview computer tools require environment and dimensions. Provide them on your Computer implementation or target a GA computer model such as gpt-5.4.');
            }
            return {
                tool: {
                    type: 'computer_use_preview',
                    environment: tool.environment,
                    display_width: tool.dimensions[0],
                    display_height: tool.dimensions[1],
                },
                include: undefined,
            };
        }
        return {
            tool: {
                type: 'computer',
            },
            include: undefined,
        };
    }
    else if (tool.type === 'shell') {
        return {
            tool: {
                type: 'shell',
                environment: toOpenAIShellEnvironment(tool.environment),
            },
            include: undefined,
        };
    }
    else if (tool.type === 'apply_patch') {
        return {
            tool: {
                type: 'apply_patch',
            },
            include: undefined,
        };
    }
    else if (tool.type === 'hosted_tool') {
        if (tool.providerData?.type === 'web_search') {
            const webSearchTool = {
                type: 'web_search',
                user_location: tool.providerData.user_location,
                filters: tool.providerData.filters,
                search_context_size: tool.providerData.search_context_size,
            };
            if (tool.providerData.external_web_access !== undefined) {
                webSearchTool.external_web_access =
                    tool.providerData.external_web_access;
            }
            return {
                tool: webSearchTool,
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'web_search_preview') {
            return {
                tool: {
                    type: 'web_search_preview',
                    user_location: tool.providerData.user_location,
                    search_context_size: tool.providerData.search_context_size,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'file_search') {
            return {
                tool: {
                    type: 'file_search',
                    vector_store_ids: tool.providerData.vector_store_ids ||
                        // for backwards compatibility
                        (typeof tool.providerData.vector_store_id === 'string'
                            ? [tool.providerData.vector_store_id]
                            : tool.providerData.vector_store_id),
                    max_num_results: tool.providerData.max_num_results,
                    ranking_options: tool.providerData.ranking_options,
                    filters: tool.providerData.filters,
                },
                include: tool.providerData.include_search_results
                    ? ['file_search_call.results']
                    : undefined,
            };
        }
        else if (tool.providerData?.type === 'code_interpreter') {
            return {
                tool: {
                    type: 'code_interpreter',
                    container: tool.providerData.container,
                },
                include: tool.providerData.include_outputs
                    ? ['code_interpreter_call.outputs']
                    : undefined,
            };
        }
        else if (tool.providerData?.type === 'tool_search') {
            return {
                tool: {
                    type: 'tool_search',
                    execution: tool.providerData.execution,
                    description: tool.providerData.description,
                    parameters: tool.providerData.parameters,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'image_generation') {
            return {
                tool: {
                    type: 'image_generation',
                    background: tool.providerData.background,
                    input_fidelity: tool.providerData.input_fidelity,
                    input_image_mask: tool.providerData.input_image_mask,
                    model: tool.providerData.model,
                    moderation: tool.providerData.moderation,
                    output_compression: tool.providerData.output_compression,
                    output_format: tool.providerData.output_format,
                    partial_images: tool.providerData.partial_images,
                    quality: tool.providerData.quality,
                    size: tool.providerData.size,
                },
                include: undefined,
            };
        }
        else if (tool.providerData?.type === 'mcp') {
            const openaiTool = {
                type: 'mcp',
                server_label: tool.providerData.server_label,
                server_url: tool.providerData.server_url,
                connector_id: tool.providerData.connector_id,
                authorization: tool.providerData.authorization,
                allowed_tools: tool.providerData.allowed_tools,
                headers: tool.providerData.headers,
                require_approval: convertMCPRequireApproval(tool.providerData.require_approval),
                server_description: tool.providerData.server_description,
            };
            if (tool.providerData.defer_loading === true) {
                openaiTool.defer_loading = true;
            }
            return {
                tool: openaiTool,
                include: undefined,
            };
        }
        else if (tool.providerData) {
            return {
                tool: tool.providerData,
                include: undefined,
            };
        }
    }
    throw new Error(`Unsupported tool type: ${JSON.stringify(tool)}`);
}
function convertMCPRequireApproval(requireApproval) {
    if (requireApproval === 'never' || requireApproval === undefined) {
        return 'never';
    }
    if (requireApproval === 'always') {
        return 'always';
    }
    return {
        never: { tool_names: requireApproval.never?.tool_names },
        always: { tool_names: requireApproval.always?.tool_names },
    };
}
function getHandoffTool(handoff) {
    return {
        name: handoff.toolName,
        description: handoff.toolDescription,
        parameters: handoff.inputJsonSchema,
        strict: handoff.strictJsonSchema,
        type: 'function',
    };
}
function getInputMessageContent(entry) {
    if (entry.type === 'input_text') {
        return {
            type: 'input_text',
            text: entry.text,
            ...getSnakeCasedProviderDataWithoutReservedKeys(entry.providerData, [
                'type',
                'text',
            ]),
        };
    }
    else if (entry.type === 'input_image') {
        const imageEntry = {
            type: 'input_image',
            detail: (entry.detail ?? 'auto'),
        };
        if (typeof entry.image === 'string') {
            imageEntry.image_url = entry.image;
        }
        else if (entry.image && 'id' in entry.image) {
            imageEntry.file_id = entry.image.id;
        }
        else if (typeof entry.imageUrl === 'string') {
            imageEntry.image_url = entry.imageUrl;
        }
        else if (typeof entry.fileId === 'string') {
            imageEntry.file_id = entry.fileId;
        }
        return {
            ...imageEntry,
            ...getSnakeCasedProviderDataWithoutReservedKeys(entry.providerData, [
                'type',
                'detail',
                'image_url',
                'file_id',
            ]),
        };
    }
    else if (entry.type === 'input_file') {
        const fileEntry = {
            type: 'input_file',
        };
        if (typeof entry.file === 'string') {
            const value = entry.file.trim();
            if (value.startsWith('data:')) {
                fileEntry.file_data = value;
            }
            else if (value.startsWith('https://')) {
                fileEntry.file_url = value;
            }
            else if (/^[A-Za-z0-9+/=]+$/.test(value)) {
                fileEntry.file_data = value;
            }
            else {
                throw new UserError(`Unsupported string data for file input. If you're trying to pass an uploaded file's ID, use an object with the ID property instead.`);
            }
        }
        else if (entry.file &&
            typeof entry.file === 'object' &&
            'id' in entry.file) {
            fileEntry.file_id = entry.file.id;
        }
        else if (entry.file &&
            typeof entry.file === 'object' &&
            'url' in entry.file) {
            fileEntry.file_url = entry.file.url;
        }
        const legacyFileData = entry.fileData;
        if (typeof legacyFileData === 'string') {
            fileEntry.file_data = legacyFileData;
        }
        const legacyFileUrl = entry.fileUrl;
        if (typeof legacyFileUrl === 'string') {
            fileEntry.file_url = legacyFileUrl;
        }
        const legacyFileId = entry.fileId;
        if (typeof legacyFileId === 'string') {
            fileEntry.file_id = legacyFileId;
        }
        if (entry.filename) {
            fileEntry.filename = entry.filename;
        }
        return {
            ...fileEntry,
            ...getSnakeCasedProviderDataWithoutReservedKeys(entry.providerData, [
                'type',
                'file_data',
                'file_url',
                'file_id',
                'filename',
            ]),
        };
    }
    throw new UserError(`Unsupported input content type: ${JSON.stringify(entry)}`);
}
function getProviderDataField(providerData, keys) {
    if (!providerData ||
        typeof providerData !== 'object' ||
        Array.isArray(providerData)) {
        return undefined;
    }
    const record = providerData;
    for (const key of keys) {
        if (typeof record[key] !== 'undefined') {
            return record[key];
        }
    }
    return undefined;
}
function getOutputMessageContent(entry) {
    if (entry.type === 'output_text') {
        const annotations = getProviderDataField(entry.providerData, ['annotations']);
        const normalizedAnnotations = Array.isArray(annotations) ? annotations : [];
        return {
            type: 'output_text',
            text: entry.text,
            annotations: normalizedAnnotations,
            ...getSnakeCasedProviderDataWithoutReservedKeys(entry.providerData, [
                'type',
                'text',
                'annotations',
            ]),
        };
    }
    if (entry.type === 'refusal') {
        return {
            type: 'refusal',
            refusal: entry.refusal,
            ...getSnakeCasedProviderDataWithoutReservedKeys(entry.providerData, [
                'type',
                'refusal',
            ]),
        };
    }
    throw new UserError(`Unsupported output content type: ${JSON.stringify(entry)}`);
}
function getMessageItem(item) {
    if (item.role === 'system') {
        return {
            id: item.id,
            role: 'system',
            content: item.content,
            ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                'id',
                'role',
                'content',
            ]),
        };
    }
    if (item.role === 'user') {
        if (typeof item.content === 'string') {
            return {
                id: item.id,
                role: 'user',
                content: item.content,
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'id',
                    'role',
                    'content',
                ]),
            };
        }
        return {
            id: item.id,
            role: 'user',
            content: item.content.map(getInputMessageContent),
            ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                'id',
                'role',
                'content',
            ]),
        };
    }
    if (item.role === 'assistant') {
        const assistantMessage = {
            type: 'message',
            id: item.id,
            role: 'assistant',
            content: item.content.map(getOutputMessageContent),
            status: item.status,
            ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                'type',
                'id',
                'role',
                'content',
                'status',
            ]),
        };
        return assistantMessage;
    }
    throw new UserError(`Unsupported item ${JSON.stringify(item)}`);
}
function isMessageItem(item) {
    if (item.type === 'message') {
        return true;
    }
    if (typeof item.type === 'undefined' && typeof item.role === 'string') {
        return true;
    }
    return false;
}
function getPrompt(prompt) {
    if (!prompt) {
        return undefined;
    }
    const transformedVariables = {};
    for (const [key, value] of Object.entries(prompt.variables ?? {})) {
        if (typeof value === 'string') {
            transformedVariables[key] = value;
        }
        else if (typeof value === 'object') {
            transformedVariables[key] = getInputMessageContent(value);
        }
    }
    return {
        id: prompt.promptId,
        version: prompt.version,
        variables: transformedVariables,
    };
}
function getInputItems(input) {
    if (typeof input === 'string') {
        return [
            {
                role: 'user',
                content: input,
            },
        ];
    }
    return input.map((item) => {
        if (isMessageItem(item)) {
            return getMessageItem(item);
        }
        if (item.type === 'tool_search_call') {
            const status = normalizeToolSearchStatus(item.status);
            const callId = getToolSearchProviderCallId(item);
            const execution = getToolSearchExecution(item);
            const toolSearchCall = {
                type: 'tool_search_call',
                id: item.id,
                ...(status !== null ? { status } : {}),
                arguments: item.arguments,
                ...(callId ? { call_id: callId } : {}),
                ...(execution ? { execution } : {}),
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'type',
                    'id',
                    'status',
                    'arguments',
                    'call_id',
                    'callId',
                    'execution',
                ]),
            };
            return toolSearchCall;
        }
        if (item.type === 'tool_search_output') {
            const status = normalizeToolSearchStatus(item.status);
            const callId = getToolSearchProviderCallId(item);
            const execution = getToolSearchExecution(item);
            const toolSearchOutput = {
                type: 'tool_search_output',
                id: item.id,
                ...(status !== null ? { status } : {}),
                tools: item.tools.map((tool) => toOpenAIToolSearchOutputToolPayload(tool)),
                ...(callId ? { call_id: callId } : {}),
                ...(execution ? { execution } : {}),
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'type',
                    'id',
                    'status',
                    'tools',
                    'call_id',
                    'callId',
                    'execution',
                ]),
            };
            return toolSearchOutput;
        }
        if (item.type === 'function_call') {
            const entry = {
                id: item.id,
                type: 'function_call',
                name: item.name,
                call_id: item.callId,
                arguments: item.arguments,
                status: item.status,
                ...(typeof item.namespace === 'string'
                    ? { namespace: item.namespace }
                    : {}),
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'id',
                    'type',
                    'name',
                    'call_id',
                    'arguments',
                    'status',
                    'namespace',
                ]),
            };
            return entry;
        }
        if (item.type === 'function_call_result') {
            const normalizedOutput = normalizeFunctionCallOutputForRequest(item.output);
            const entry = {
                type: 'function_call_output',
                id: item.id,
                call_id: item.callId,
                output: normalizedOutput,
                status: item.status,
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'type',
                    'id',
                    'call_id',
                    'output',
                    'status',
                    'namespace',
                ]),
            };
            return entry;
        }
        if (item.type === 'reasoning') {
            const encryptedContent = getProviderDataField(item.providerData, [
                'encryptedContent',
                'encrypted_content',
            ]);
            const entry = {
                id: item.id,
                type: 'reasoning',
                summary: item.content.map((content) => ({
                    type: 'summary_text',
                    text: content.text,
                    ...getSnakeCasedProviderDataWithoutReservedKeys(content.providerData, ['type', 'text']),
                })),
                ...(typeof encryptedContent === 'string'
                    ? { encrypted_content: encryptedContent }
                    : {}),
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'id',
                    'type',
                    'summary',
                    'encrypted_content',
                ]),
            };
            return entry;
        }
        if (item.type === 'computer_call') {
            const pendingSafetyChecks = getProviderDataField(item.providerData, ['pendingSafetyChecks', 'pending_safety_checks']);
            const batchedActions = Array.isArray(item.actions)
                ? (item
                    .actions ?? [])
                : [];
            const actionPayload = batchedActions.length > 0
                ? {
                    action: item.action ?? batchedActions[0],
                    actions: batchedActions,
                }
                : item.action
                    ? { action: item.action }
                    : {};
            // The live API rejects empty pending_safety_checks on replayed computer calls.
            const entry = {
                type: 'computer_call',
                call_id: item.callId,
                id: item.id,
                status: item.status,
                ...(Array.isArray(pendingSafetyChecks) && pendingSafetyChecks.length > 0
                    ? { pending_safety_checks: pendingSafetyChecks }
                    : {}),
                ...actionPayload,
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'type',
                    'call_id',
                    'id',
                    'action',
                    'actions',
                    'status',
                    'pending_safety_checks',
                ]),
            };
            return entry;
        }
        if (item.type === 'computer_call_result') {
            const acknowledgedSafetyChecks = getProviderDataField(item.providerData, [
                'acknowledgedSafetyChecks',
                'acknowledged_safety_checks',
            ]);
            const entry = {
                type: 'computer_call_output',
                id: item.id,
                call_id: item.callId,
                output: buildResponseOutput(item),
                status: item.providerData?.status,
                ...(Array.isArray(acknowledgedSafetyChecks) &&
                    acknowledgedSafetyChecks.length > 0
                    ? { acknowledged_safety_checks: acknowledgedSafetyChecks }
                    : {}),
                ...getSnakeCasedProviderDataWithoutReservedKeys(item.providerData, [
                    'type',
                    'id',
                    'call_id',
                    'output',
                    'status',
                    'acknowledged_safety_checks',
                ]),
            };
            return entry;
        }
        if (item.type === 'shell_call') {
            const action = {
                commands: item.action.commands,
                timeout_ms: typeof item.action.timeoutMs === 'number'
                    ? item.action.timeoutMs
                    : null,
                max_output_length: typeof item.action.maxOutputLength === 'number'
                    ? item.action.maxOutputLength
                    : null,
            };
            const shellProviderData = getShellCallProviderDataForInput(item.providerData);
            const entry = {
                type: 'shell_call',
                id: item.id,
                call_id: item.callId,
                status: item.status ?? 'in_progress',
                action,
                ...shellProviderData,
            };
            return entry;
        }
        if (item.type === 'shell_call_output') {
            const shellOutputs = item.output;
            const sanitizedOutputs = shellOutputs.map((entry) => {
                const outcome = entry?.outcome;
                const exitCode = outcome?.type === 'exit' ? outcome.exitCode : null;
                return {
                    stdout: typeof entry?.stdout === 'string' ? entry.stdout : '',
                    stderr: typeof entry?.stderr === 'string' ? entry.stderr : '',
                    outcome: outcome?.type === 'timeout'
                        ? { type: 'timeout' }
                        : { type: 'exit', exit_code: exitCode ?? 0 },
                };
            });
            const entry = {
                type: 'shell_call_output',
                call_id: item.callId,
                output: sanitizedOutputs,
                id: item.id ?? undefined,
            };
            if (typeof item.maxOutputLength === 'number') {
                entry.max_output_length = item.maxOutputLength;
            }
            return entry;
        }
        if (item.type === 'apply_patch_call') {
            if (!item.operation) {
                throw new UserError('apply_patch_call missing operation');
            }
            const entry = {
                type: 'apply_patch_call',
                id: item.id ?? undefined,
                call_id: item.callId,
                status: item.status ?? 'in_progress',
                operation: item.operation,
            };
            return entry;
        }
        if (item.type === 'apply_patch_call_output') {
            const entry = {
                type: 'apply_patch_call_output',
                id: item.id ?? undefined,
                call_id: item.callId,
                status: item.status ?? 'completed',
                output: item.output ?? undefined,
            };
            return entry;
        }
        if (item.type === 'hosted_tool_call') {
            if (item.providerData?.type === 'web_search_call' ||
                item.providerData?.type === 'web_search' // for backward compatibility
            ) {
                const providerData = camelOrSnakeToSnakeCase(item.providerData) ?? {};
                const hasAction = providerData.action !== undefined;
                const hasValidAction = isRecord(providerData.action) &&
                    typeof providerData.action.type === 'string';
                if (hasAction && !hasValidAction) {
                    throw new UserError('web_search_call invalid action');
                }
                const entry = {
                    ...providerData, // place here to prioritize the below fields
                    type: 'web_search_call',
                    id: item.id,
                    status: WebSearchStatus.parse(item.status ?? 'failed'),
                };
                if (hasValidAction) {
                    entry.action =
                        providerData.action;
                }
                return entry;
            }
            if (item.providerData?.type === 'file_search_call' ||
                item.providerData?.type === 'file_search' // for backward compatibility
            ) {
                const entry = {
                    ...camelOrSnakeToSnakeCase(item.providerData), // place here to prioritize the below fields
                    type: 'file_search_call',
                    id: item.id,
                    status: FileSearchStatus.parse(item.status ?? 'failed'),
                    queries: item.providerData?.queries ?? [],
                    results: item.providerData?.results,
                };
                return entry;
            }
            if (item.providerData?.type === 'code_interpreter_call' ||
                item.providerData?.type === 'code_interpreter' // for backward compatibility
            ) {
                const entry = {
                    ...camelOrSnakeToSnakeCase(item.providerData), // place here to prioritize the below fields
                    type: 'code_interpreter_call',
                    id: item.id,
                    code: item.providerData?.code ?? '',
                    // This property used to be results, so keeping both for backward compatibility
                    // That said, this property cannot be passed from a user, so it's just API's internal data.
                    outputs: item.providerData?.outputs ?? item.providerData?.results ?? [],
                    status: CodeInterpreterStatus.parse(item.status ?? 'failed'),
                    container_id: item.providerData?.container_id,
                };
                return entry;
            }
            if (item.providerData?.type === 'image_generation_call' ||
                item.providerData?.type === 'image_generation' // for backward compatibility
            ) {
                const entry = {
                    ...camelOrSnakeToSnakeCase(item.providerData), // place here to prioritize the below fields
                    type: 'image_generation_call',
                    id: item.id,
                    result: item.providerData?.result ?? null,
                    status: ImageGenerationStatus.parse(item.status ?? 'failed'),
                };
                return entry;
            }
            if (item.providerData?.type === 'mcp_list_tools' ||
                item.name === 'mcp_list_tools') {
                const providerData = item.providerData;
                const entry = {
                    ...camelOrSnakeToSnakeCase(item.providerData),
                    type: 'mcp_list_tools',
                    id: item.id,
                    tools: camelOrSnakeToSnakeCase(providerData.tools),
                    server_label: providerData.server_label,
                    error: providerData.error,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_approval_request' ||
                item.name === 'mcp_approval_request') {
                const providerData = item.providerData;
                const entry = {
                    ...camelOrSnakeToSnakeCase(item.providerData), // place here to prioritize the below fields
                    type: 'mcp_approval_request',
                    id: providerData.id ?? item.id,
                    name: providerData.name,
                    arguments: providerData.arguments,
                    server_label: providerData.server_label,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_approval_response' ||
                item.name === 'mcp_approval_response') {
                const providerData = item.providerData;
                const entry = {
                    ...camelOrSnakeToSnakeCase(providerData),
                    type: 'mcp_approval_response',
                    id: providerData.id,
                    approve: providerData.approve,
                    approval_request_id: providerData.approval_request_id,
                    reason: providerData.reason,
                };
                return entry;
            }
            else if (item.providerData?.type === 'mcp_call' ||
                item.name === 'mcp_call') {
                const providerData = item.providerData;
                const entry = {
                    // output, which can be a large text string, is optional here, so we don't include it
                    // output: item.output,
                    ...camelOrSnakeToSnakeCase(providerData), // place here to prioritize the below fields
                    type: 'mcp_call',
                    id: providerData.id ?? item.id,
                    name: providerData.name,
                    arguments: providerData.arguments,
                    server_label: providerData.server_label,
                    error: providerData.error,
                };
                return entry;
            }
            throw new UserError(`Unsupported built-in tool call type: ${JSON.stringify(item)}`);
        }
        if (item.type === 'compaction') {
            const encryptedContent = item.encrypted_content ?? item.encryptedContent;
            if (typeof encryptedContent !== 'string') {
                throw new UserError('Compaction item missing encrypted_content');
            }
            return {
                type: 'compaction',
                id: item.id ?? undefined,
                encrypted_content: encryptedContent,
            };
        }
        if (item.type === 'unknown') {
            return {
                ...camelOrSnakeToSnakeCase(item.providerData), // place here to prioritize the below fields
                id: item.id,
            };
        }
        const exhaustive = item;
        throw new UserError(`Unsupported item ${JSON.stringify(exhaustive)}`);
    });
}
// As of May 29, the output is always screenshot putput
function buildResponseOutput(item) {
    return {
        type: 'computer_screenshot',
        image_url: item.output.data,
    };
}
function convertToMessageContentItem(item) {
    if (item.type === 'output_text') {
        const { type, text, ...providerData } = item;
        return {
            type,
            text,
            ...(Object.keys(providerData).length > 0 ? { providerData } : {}),
        };
    }
    if (item.type === 'refusal') {
        const { type, refusal, ...providerData } = item;
        return {
            type,
            refusal,
            ...(Object.keys(providerData).length > 0 ? { providerData } : {}),
        };
    }
    throw new Error(`Unsupported message content type: ${JSON.stringify(item)}`);
}
function convertToOutputItem(items) {
    return items.map((item) => {
        if (item.type === 'message') {
            const { id, type, role, content, status, ...providerData } = item;
            return {
                id,
                type,
                role,
                content: content.map(convertToMessageContentItem),
                status,
                providerData,
            };
        }
        else if (item.type === 'tool_search_call') {
            const { id, type: _type, status, arguments: args, ...providerData } = item;
            const output = {
                type: 'tool_search_call',
                id,
                status,
                arguments: args,
                providerData,
            };
            return output;
        }
        else if (item.type === 'tool_search_output') {
            const { id, type: _type, status, tools, ...providerData } = item;
            const output = {
                type: 'tool_search_output',
                id,
                status,
                tools: Array.isArray(tools)
                    ? tools.map((tool) => fromOpenAIToolSearchOutputToolPayload(tool))
                    : [],
                providerData,
            };
            return output;
        }
        else if (item.type === 'file_search_call' ||
            item.type === 'web_search_call' ||
            item.type === 'image_generation_call' ||
            item.type === 'code_interpreter_call') {
            const { status, ...remainingItem } = item;
            let outputData = undefined;
            if ('result' in remainingItem && remainingItem.result !== null) {
                // type: "image_generation_call"
                outputData = remainingItem.result;
                delete remainingItem.result;
            }
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status,
                output: outputData,
                providerData: remainingItem,
            };
            return output;
        }
        else if (item.type === 'function_call') {
            const functionCall = item;
            const { call_id, name, namespace, status, arguments: args, ...providerData } = functionCall;
            const output = {
                type: 'function_call',
                id: functionCall.id,
                callId: call_id,
                name,
                ...(typeof namespace === 'string' ? { namespace } : {}),
                status,
                arguments: args,
                providerData,
            };
            return output;
        }
        else if (item.type === 'function_call_output') {
            const { call_id, status, output: rawOutput, name: toolName, function_name: functionName, namespace, ...providerData } = item;
            const output = {
                type: 'function_call_result',
                id: item.id,
                callId: call_id,
                name: toolName ?? functionName ?? call_id,
                ...(typeof namespace === 'string' ? { namespace } : {}),
                status: status ?? 'completed',
                output: convertFunctionCallOutputToProtocol(rawOutput),
                providerData,
            };
            return output;
        }
        else if (item.type === 'computer_call') {
            const { call_id, status, action, actions, ...providerData } = item;
            const normalizedActions = Array.isArray(actions) && actions.length > 0 ? actions : undefined;
            if (!normalizedActions && !action) {
                throw new UserError(`Unsupported computer call item without an action or actions: ${JSON.stringify(item)}`);
            }
            const output = {
                type: 'computer_call',
                id: item.id,
                callId: call_id,
                status,
                action: action ?? normalizedActions?.[0],
                ...(normalizedActions ? { actions: normalizedActions } : {}),
                providerData,
            };
            return output;
        }
        else if (item.type === 'shell_call') {
            const { call_id, status, action, ...providerData } = item;
            const shellAction = {
                commands: Array.isArray(action?.commands) ? action.commands : [],
            };
            const timeout = action?.timeout_ms;
            if (typeof timeout === 'number') {
                shellAction.timeoutMs = timeout;
            }
            const maxOutputLength = action?.max_output_length;
            if (typeof maxOutputLength === 'number') {
                shellAction.maxOutputLength = maxOutputLength;
            }
            const output = {
                type: 'shell_call',
                id: item.id ?? undefined,
                callId: call_id,
                status: status ?? 'in_progress',
                action: shellAction,
                providerData,
            };
            return output;
        }
        else if (item.type === 'shell_call_output') {
            const { call_id, output: responseOutput, max_output_length, ...providerData } = item;
            let normalizedOutput = [];
            if (Array.isArray(responseOutput)) {
                normalizedOutput = responseOutput.map((entry) => ({
                    stdout: typeof entry?.stdout === 'string' ? entry.stdout : '',
                    stderr: typeof entry?.stderr === 'string' ? entry.stderr : '',
                    outcome: entry?.outcome?.type === 'timeout'
                        ? { type: 'timeout' }
                        : {
                            type: 'exit',
                            exitCode: typeof entry?.outcome?.exit_code === 'number'
                                ? entry.outcome.exit_code
                                : null,
                        },
                }));
            }
            const output = {
                type: 'shell_call_output',
                id: item.id ?? undefined,
                callId: call_id,
                output: normalizedOutput,
                providerData,
            };
            if (typeof max_output_length === 'number') {
                output.maxOutputLength = max_output_length;
            }
            return output;
        }
        else if (item.type === 'apply_patch_call') {
            const { call_id, status, operation, ...providerData } = item;
            if (!operation) {
                throw new UserError('apply_patch_call missing operation');
            }
            let normalizedOperation;
            switch (operation.type) {
                case 'create_file':
                    normalizedOperation = {
                        type: 'create_file',
                        path: operation.path,
                        diff: operation.diff,
                    };
                    break;
                case 'delete_file':
                    normalizedOperation = {
                        type: 'delete_file',
                        path: operation.path,
                    };
                    break;
                case 'update_file':
                    normalizedOperation = {
                        type: 'update_file',
                        path: operation.path,
                        diff: operation.diff,
                    };
                    break;
                default:
                    throw new UserError('Unknown apply_patch operation type');
            }
            const output = {
                type: 'apply_patch_call',
                id: item.id ?? undefined,
                callId: call_id,
                status: status ?? 'in_progress',
                operation: normalizedOperation,
                providerData,
            };
            return output;
        }
        else if (item.type === 'apply_patch_call_output') {
            const { call_id, status, output: responseOutput, ...providerData } = item;
            const output = {
                type: 'apply_patch_call_output',
                id: item.id ?? undefined,
                callId: call_id,
                status,
                output: typeof responseOutput === 'string' ? responseOutput : undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_list_tools') {
            const { ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status: 'completed',
                output: undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_approval_request') {
            const { ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: 'mcp_approval_request',
                status: 'completed',
                output: undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'mcp_call') {
            // Avoiding to duplicate potentially large output data
            const { output: outputData, ...providerData } = item;
            const output = {
                type: 'hosted_tool_call',
                id: item.id,
                name: item.type,
                status: 'completed',
                output: outputData || undefined,
                providerData,
            };
            return output;
        }
        else if (item.type === 'reasoning') {
            // Avoiding to duplicate potentially large summary data
            const { summary, ...providerData } = item;
            const output = {
                type: 'reasoning',
                id: item.id,
                content: summary.map((content) => {
                    // Avoiding to duplicate potentially large text
                    const { text, ...remainingContent } = content;
                    return {
                        type: 'input_text',
                        text,
                        providerData: remainingContent,
                    };
                }),
                providerData,
            };
            return output;
        }
        else if (item.type === 'compaction') {
            const { encrypted_content, created_by, ...providerData } = item;
            if (typeof encrypted_content !== 'string') {
                throw new UserError('Compaction item missing encrypted_content');
            }
            const output = {
                type: 'compaction',
                id: item.id ?? undefined,
                encrypted_content,
                created_by,
                providerData,
            };
            return output;
        }
        return {
            type: 'unknown',
            id: item.id,
            providerData: item,
        };
    });
}
export { getToolChoice, converTool, getInputItems, convertToOutputItem };
const TERMINAL_RESPONSES_STREAM_EVENT_TYPES = new Set([
    'response.completed',
    'response.failed',
    'response.incomplete',
    'response.error',
]);
function isTerminalResponsesStreamEventType(eventType) {
    return (typeof eventType === 'string' &&
        TERMINAL_RESPONSES_STREAM_EVENT_TYPES.has(eventType));
}
function getOpenAIResponseRequestId(response) {
    const requestId = response
        ?._request_id;
    return typeof requestId === 'string' && requestId.length > 0
        ? requestId
        : undefined;
}
function attachOpenAIResponseRequestId(response, requestId) {
    if (!requestId) {
        return;
    }
    const currentRequestId = getOpenAIResponseRequestId(response);
    if (currentRequestId) {
        return;
    }
    try {
        Object.defineProperty(response, '_request_id', {
            value: requestId,
            enumerable: false,
        });
    }
    catch {
        // Some custom clients may freeze their response objects. In that case we
        // still expose requestId on the normalized SDK response.
    }
}
async function* withAttachedResponseRequestId(stream, requestId) {
    for await (const event of stream) {
        const eventType = event.type;
        if (isTerminalResponsesStreamEventType(eventType)) {
            const response = event.response;
            if (response && typeof response === 'object') {
                attachOpenAIResponseRequestId(response, requestId);
            }
        }
        yield event;
    }
}
/**
 * Model implementation that uses OpenAI's Responses API to generate responses.
 */
export class OpenAIResponsesModel {
    _client;
    _model;
    constructor(client, model) {
        this._client = client;
        this._model = model;
    }
    getRetryAdvice(args) {
        return getOpenAIRetryAdvice(args);
    }
    async _fetchResponse(request, stream) {
        const builtRequest = this._buildResponsesCreateRequest(request, stream);
        const requestOptions = {
            headers: builtRequest.sdkRequestHeaders,
            signal: builtRequest.signal,
            ...(builtRequest.transportExtraQuery
                ? { query: builtRequest.transportExtraQuery }
                : {}),
        };
        if (request._internal?.runnerManagedRetry === true) {
            requestOptions.maxRetries = 0;
        }
        const responsePromise = this._client.responses.create(builtRequest.requestData, requestOptions);
        let response;
        if (stream) {
            const withResponse = responsePromise
                .withResponse;
            if (typeof withResponse === 'function') {
                const streamedResponse = await withResponse.call(responsePromise);
                response = withAttachedResponseRequestId(streamedResponse.data, streamedResponse.request_id ?? undefined);
            }
            else {
                response =
                    (await responsePromise);
            }
        }
        else {
            response = (await responsePromise);
        }
        if (logger.dontLogModelData) {
            logger.debug('Response received');
        }
        else {
            logger.debug(`Response received: ${JSON.stringify(response, null, 2)}`);
        }
        return response;
    }
    _buildResponsesCreateRequest(request, stream) {
        const input = getInputItems(request.input);
        const prompt = getPrompt(request.prompt);
        // When a prompt template already declares a model, skip sending the agent's default model.
        // If the caller explicitly requests an override, include the resolved model name in the request.
        const shouldSendModel = !request.prompt || request.overridePromptModel === true;
        const effectiveRequestModel = shouldSendModel ? this._model : undefined;
        const { providerData: providerDataWithoutTransport, overrides: transportOverrides, } = splitResponsesTransportOverrides(request.modelSettings.providerData);
        const { tools, include } = getTools(request.tools, request.handoffs, {
            model: effectiveRequestModel,
            toolChoice: request.modelSettings.toolChoice,
        });
        const toolChoiceValidationTools = [
            ...tools,
            ...getExtraBodyToolsForToolChoiceValidation(transportOverrides.extraBody),
        ];
        const allowPromptSuppliedTools = Boolean(request.prompt) &&
            !(request.toolsExplicitlyProvided === true && tools.length === 0);
        const toolChoice = getToolChoice(request.modelSettings.toolChoice, {
            tools: toolChoiceValidationTools,
            model: effectiveRequestModel,
            allowPromptSuppliedComputerTool: allowPromptSuppliedTools,
        });
        assertSupportedToolChoice(toolChoice, toolChoiceValidationTools, {
            allowPromptSuppliedTools,
        });
        const { text, ...restOfProviderData } = providerDataWithoutTransport;
        if (request.modelSettings.reasoning) {
            // Merge top-level reasoning settings with provider data.
            restOfProviderData.reasoning = {
                ...request.modelSettings.reasoning,
                ...restOfProviderData.reasoning,
            };
        }
        let mergedText = text;
        if (request.modelSettings.text) {
            // Merge top-level text settings with provider data.
            mergedText = { ...request.modelSettings.text, ...text };
        }
        const responseFormat = getResponseFormat(request.outputType, mergedText);
        let parallelToolCalls = undefined;
        if (typeof request.modelSettings.parallelToolCalls === 'boolean') {
            parallelToolCalls = request.modelSettings.parallelToolCalls;
        }
        const shouldSendTools = tools.length > 0 ||
            request.toolsExplicitlyProvided === true ||
            !request.prompt;
        const compatibleToolChoice = getCompatibleToolChoice(toolChoice, toolChoiceValidationTools, {
            allowPromptSuppliedTools,
        });
        const shouldOmitToolChoice = typeof compatibleToolChoice === 'undefined';
        let requestData = {
            ...(effectiveRequestModel ? { model: effectiveRequestModel } : {}),
            instructions: normalizeInstructions(request.systemInstructions),
            input,
            include,
            ...(shouldSendTools ? { tools } : {}),
            // The Responses API treats `conversation` and `previous_response_id` as mutually exclusive,
            // so we only send `previous_response_id` when no conversation is provided.
            conversation: request.conversationId,
            ...(request.conversationId
                ? {}
                : { previous_response_id: request.previousResponseId }),
            prompt,
            temperature: request.modelSettings.temperature,
            top_p: request.modelSettings.topP,
            truncation: request.modelSettings.truncation,
            max_output_tokens: request.modelSettings.maxTokens,
            ...(!shouldOmitToolChoice
                ? { tool_choice: compatibleToolChoice }
                : {}),
            parallel_tool_calls: parallelToolCalls,
            stream,
            text: responseFormat,
            store: request.modelSettings.store,
            prompt_cache_retention: request.modelSettings.promptCacheRetention,
            ...restOfProviderData,
        };
        if (transportOverrides.extraBody) {
            requestData = {
                ...requestData,
                ...transportOverrides.extraBody,
            };
        }
        // Keep the transport mode aligned with the calling path even if extra_body includes stream.
        requestData.stream = stream;
        const requestHeaderAccumulator = createHeaderAccumulator();
        applyHeadersToAccumulator(requestHeaderAccumulator, HEADERS);
        applyHeadersToAccumulator(requestHeaderAccumulator, transportOverrides.extraHeaders, {
            allowBlockedOverride: true,
        });
        const sdkRequestHeaders = headerAccumulatorToSDKHeaders(requestHeaderAccumulator);
        const builtRequest = {
            requestData,
            sdkRequestHeaders,
            signal: request.signal,
            transportExtraHeaders: transportOverrides.extraHeaders,
            transportExtraQuery: transportOverrides.extraQuery,
        };
        if (logger.dontLogModelData) {
            logger.debug('Calling LLM');
        }
        else {
            logger.debug(`Calling LLM. Request data: ${JSON.stringify(builtRequest.requestData, null, 2)}`);
        }
        return builtRequest;
    }
    /**
     * Get a response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns A promise that resolves to the response from the model.
     */
    async getResponse(request) {
        const response = await withResponseSpan(async (span) => {
            const response = await this._fetchResponse(request, false);
            if (request.tracing) {
                span.spanData.response_id = response.id;
                span.spanData._input = request.input;
                span.spanData._response = response;
            }
            return response;
        });
        const output = {
            usage: new Usage({
                inputTokens: response.usage?.input_tokens ?? 0,
                outputTokens: response.usage?.output_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
                inputTokensDetails: { ...response.usage?.input_tokens_details },
                outputTokensDetails: { ...response.usage?.output_tokens_details },
                requestUsageEntries: [
                    toRequestUsageEntry(response.usage, 'responses.create'),
                ],
            }),
            output: convertToOutputItem(response.output),
            responseId: response.id,
            requestId: getOpenAIResponseRequestId(response),
            providerData: response,
        };
        return output;
    }
    /**
     * Get a streamed response from the OpenAI model using the Responses API.
     * @param request - The request to send to the model.
     * @returns An async iterable of the response from the model.
     */
    async *getStreamedResponse(request) {
        const span = request.tracing ? createResponseSpan() : undefined;
        try {
            if (span) {
                span.start();
                setCurrentSpan(span);
                if (request.tracing === true) {
                    span.spanData._input = request.input;
                }
            }
            const response = await this._fetchResponse(request, true);
            let finalResponse;
            for await (const event of response) {
                const eventType = event.type;
                if (eventType === 'response.created') {
                    yield {
                        type: 'response_started',
                        providerData: {
                            ...event,
                        },
                    };
                }
                else if (isTerminalResponsesStreamEventType(eventType)) {
                    const terminalEvent = event;
                    finalResponse = terminalEvent.response;
                    const { response, ...remainingEvent } = terminalEvent;
                    const { output, usage, id, ...remainingResponse } = response;
                    yield {
                        type: 'response_done',
                        response: {
                            id: id,
                            requestId: getOpenAIResponseRequestId(response),
                            output: convertToOutputItem(output),
                            usage: {
                                inputTokens: usage?.input_tokens ?? 0,
                                outputTokens: usage?.output_tokens ?? 0,
                                totalTokens: usage?.total_tokens ?? 0,
                                inputTokensDetails: {
                                    ...usage?.input_tokens_details,
                                },
                                outputTokensDetails: {
                                    ...usage?.output_tokens_details,
                                },
                                requestUsageEntries: [
                                    toRequestUsageEntry(usage, 'responses.create'),
                                ],
                            },
                            providerData: remainingResponse,
                        },
                        providerData: remainingEvent,
                    };
                    if (eventType === 'response.completed') {
                        yield {
                            type: 'model',
                            event: event,
                            providerData: {
                                rawModelEventSource: OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE,
                            },
                        };
                    }
                }
                else if (eventType === 'response.output_text.delta') {
                    const { delta, ...remainingEvent } = event;
                    yield {
                        type: 'output_text_delta',
                        delta: delta,
                        providerData: remainingEvent,
                    };
                }
                yield {
                    type: 'model',
                    event: event,
                    providerData: {
                        rawModelEventSource: OPENAI_RESPONSES_RAW_MODEL_EVENT_SOURCE,
                    },
                };
            }
            if (request.tracing && span && finalResponse) {
                span.spanData.response_id = finalResponse.id;
                span.spanData._response = finalResponse;
            }
        }
        catch (error) {
            if (span) {
                span.setError({
                    message: 'Error streaming response',
                    data: {
                        error: request.tracing
                            ? String(error)
                            : error instanceof Error
                                ? error.name
                                : undefined,
                    },
                });
            }
            throw error;
        }
        finally {
            if (span) {
                span.end();
                resetCurrentSpan();
            }
        }
    }
}
/**
 * Model implementation that uses the OpenAI Responses API over a websocket transport.
 *
 * @see {@link https://developers.openai.com/api/docs/guides/websocket-mode}
 */
export class OpenAIResponsesWSModel extends OpenAIResponsesModel {
    #websocketBaseURL;
    #reuseConnection;
    #wsConnection;
    #wsConnectionIdentity;
    #wsRequestLock = Promise.resolve();
    constructor(client, model, options = {}) {
        super(client, model);
        this.#websocketBaseURL = options.websocketBaseURL;
        this.#reuseConnection = options.reuseConnection ?? true;
    }
    getRetryAdvice(args) {
        if (isNeverSentWebSocketError(args.error)) {
            return {
                suggested: true,
                replaySafety: 'safe',
                reason: args.error instanceof Error ? args.error.message : undefined,
            };
        }
        if (isAmbiguousWebSocketReplayError(args.error)) {
            return {
                suggested: false,
                replaySafety: 'unsafe',
                reason: args.error instanceof Error ? args.error.message : undefined,
            };
        }
        return super.getRetryAdvice(args);
    }
    async _fetchResponse(request, stream) {
        // The websocket transport always uses streamed Responses events, then callers either
        // consume the stream directly or collapse it into the final terminal response.
        const builtRequest = this._buildResponsesCreateRequest(request, true);
        if (stream) {
            return this.#iterWebSocketResponseEvents(builtRequest);
        }
        let finalResponse;
        let receivedAnyEvent = false;
        try {
            for await (const event of this.#iterWebSocketResponseEvents(builtRequest)) {
                receivedAnyEvent = true;
                const eventType = event.type;
                if (isTerminalResponsesStreamEventType(eventType)) {
                    finalResponse = event
                        .response;
                }
            }
        }
        catch (error) {
            if (receivedAnyEvent && error instanceof Error) {
                error.unsafeToReplay = true;
            }
            throw error;
        }
        if (!finalResponse) {
            throw new Error('Responses websocket stream ended without a terminal response event.');
        }
        return finalResponse;
    }
    async close() {
        await this.#dropWebSocketConnection();
    }
    async *#iterWebSocketResponseEvents(builtRequest) {
        const requestTimeoutDeadline = this.#createWebSocketRequestTimeoutDeadline();
        const releaseLock = await this.#acquireWebSocketRequestLock(builtRequest.signal, requestTimeoutDeadline);
        let receivedAnyEvent = false;
        let sawTerminalResponseEvent = false;
        try {
            throwIfAborted(builtRequest.signal);
            const { frame, wsURL, headers } = await this.#prepareWebSocketRequest(builtRequest, requestTimeoutDeadline);
            throwIfAborted(builtRequest.signal);
            let connection = await this.#ensureWebSocketConnection(wsURL, headers, builtRequest.signal, requestTimeoutDeadline);
            let reusedConnectionForCurrentAttempt = connection.reused;
            let activeConnection = connection.connection;
            const setActiveConnection = (nextConnection) => {
                connection = nextConnection;
                activeConnection = nextConnection.connection;
                reusedConnectionForCurrentAttempt = nextConnection.reused;
            };
            throwIfAborted(builtRequest.signal);
            const serializedFrame = JSON.stringify(frame);
            const sendSerializedFrame = async () => {
                try {
                    await activeConnection.send(serializedFrame);
                }
                catch (error) {
                    if (!isWebSocketNotOpenError(error)) {
                        throw error;
                    }
                    setActiveConnection(await this.#reconnectWebSocketConnection(wsURL, headers, builtRequest.signal, requestTimeoutDeadline));
                    await activeConnection.send(serializedFrame);
                }
            };
            await sendSerializedFrame();
            while (true) {
                const rawFrame = await this.#nextWebSocketFrame(activeConnection, builtRequest.signal, requestTimeoutDeadline);
                if (rawFrame === null) {
                    if (!receivedAnyEvent && reusedConnectionForCurrentAttempt) {
                        // The request frame was already sent on a reused socket. If the
                        // socket closes before the first response event arrives, the server
                        // may still be processing the request, so replaying `response.create`
                        // can duplicate model work and tool side effects.
                        receivedAnyEvent = true;
                        throw new Error('Responses websocket connection closed after sending a request on a reused connection before any response events were received. The request may have been accepted, so the SDK will not automatically retry this websocket request.');
                    }
                    throw new ResponsesWebSocketInternalError('connection_closed_before_terminal_response_event', 'Responses websocket connection closed before a terminal response event.');
                }
                const payloadText = await webSocketFrameToText(rawFrame);
                const payload = JSON.parse(payloadText);
                const eventType = isRecord(payload) && typeof payload.type === 'string'
                    ? payload.type
                    : undefined;
                if (eventType === 'error') {
                    receivedAnyEvent = true;
                    throw new Error(`Responses websocket error: ${JSON.stringify(payload)}`);
                }
                const event = payload;
                const isTerminalResponseEvent = isTerminalResponsesStreamEventType(eventType);
                // Successful websocket responses do not currently expose a transport
                // request ID analogous to the HTTP x-request-id header.
                receivedAnyEvent = true;
                if (isTerminalResponseEvent) {
                    sawTerminalResponseEvent = true;
                }
                yield event;
                if (isTerminalResponseEvent) {
                    return;
                }
            }
        }
        catch (error) {
            if (!receivedAnyEvent &&
                !(error instanceof OpenAI.APIUserAbortError) &&
                shouldWrapNoEventWebSocketError(error)) {
                const wrappedError = new Error('Responses websocket connection closed before any response events were received. The feature may not be enabled for this account or model yet.');
                if (error instanceof Error) {
                    wrappedError.cause = error;
                }
                throw wrappedError;
            }
            throw error;
        }
        finally {
            const shouldDropConnection = !sawTerminalResponseEvent || !this.#reuseConnection;
            const dropConnectionPromise = shouldDropConnection
                ? this.#dropWebSocketConnection()
                : undefined;
            releaseLock();
            await dropConnectionPromise;
        }
    }
    async #prepareWebSocketRequest(builtRequest, requestTimeoutDeadline) {
        const wsURL = this.#prepareWebSocketURL(builtRequest.transportExtraQuery);
        const headers = await this.#mergeWebSocketHeaders(wsURL, builtRequest.transportExtraHeaders, builtRequest.signal, requestTimeoutDeadline);
        const frame = {
            ...builtRequest.requestData,
            type: 'response.create',
            stream: true,
        };
        return { frame, wsURL, headers };
    }
    async #mergeWebSocketHeaders(wsURL, extraHeaders, signal, requestTimeoutDeadline) {
        await this.#awaitWebSocketRequestTimedOperation(this.#refreshClientApiKey(), signal, requestTimeoutDeadline, (configuredTimeoutMs) => `Responses websocket auth header preparation timed out after ${configuredTimeoutMs}ms.`);
        const headerAccumulator = createHeaderAccumulator();
        const clientWithInternals = this._client;
        const handshakeURL = new URL(wsURL);
        const handshakeQuery = searchParamsToAuthHeaderQuery(handshakeURL.searchParams);
        const authHeaders = typeof clientWithInternals.authHeaders === 'function'
            ? await this.#awaitWebSocketRequestTimedOperation(clientWithInternals.authHeaders({
                method: 'get',
                path: handshakeURL.pathname,
                ...(handshakeQuery ? { query: handshakeQuery } : {}),
            }), signal, requestTimeoutDeadline, (configuredTimeoutMs) => `Responses websocket auth header preparation timed out after ${configuredTimeoutMs}ms.`)
            : undefined;
        applyHeadersToAccumulator(headerAccumulator, authHeaders);
        if (typeof clientWithInternals.authHeaders !== 'function' &&
            typeof this._client.apiKey === 'string' &&
            this._client.apiKey.length > 0 &&
            this._client.apiKey !== 'Missing Key') {
            applyHeadersToAccumulator(headerAccumulator, {
                Authorization: `Bearer ${this._client.apiKey}`,
            });
        }
        if (this._client.organization) {
            applyHeadersToAccumulator(headerAccumulator, {
                'OpenAI-Organization': this._client.organization,
            });
        }
        if (this._client.project) {
            applyHeadersToAccumulator(headerAccumulator, {
                'OpenAI-Project': this._client.project,
            });
        }
        applyHeadersToAccumulator(headerAccumulator, clientWithInternals._options?.defaultHeaders);
        applyHeadersToAccumulator(headerAccumulator, HEADERS);
        applyHeadersToAccumulator(headerAccumulator, extraHeaders, {
            allowBlockedOverride: true,
        });
        return headerAccumulatorToRecord(headerAccumulator);
    }
    #prepareWebSocketURL(extraQuery) {
        const baseURL = new URL(this.#websocketBaseURL ?? this._client.baseURL);
        const explicitBaseQuery = typeof this.#websocketBaseURL === 'string'
            ? new URLSearchParams(baseURL.search)
            : undefined;
        const clientWithInternals = this._client;
        if (baseURL.protocol === 'https:') {
            baseURL.protocol = 'wss:';
        }
        else if (baseURL.protocol === 'http:') {
            baseURL.protocol = 'ws:';
        }
        else if (baseURL.protocol !== 'ws:' && baseURL.protocol !== 'wss:') {
            throw new UserError(`Unsupported websocket base URL protocol: ${baseURL.protocol}`);
        }
        baseURL.pathname = ensureResponsesWebSocketPath(baseURL.pathname);
        mergeQueryParamsIntoURL(baseURL, clientWithInternals._options?.defaultQuery);
        if (explicitBaseQuery && Array.from(explicitBaseQuery.keys()).length > 0) {
            const explicitTopLevelKeys = new Set();
            for (const key of explicitBaseQuery.keys()) {
                const bracketIndex = key.indexOf('[');
                explicitTopLevelKeys.add(bracketIndex >= 0 ? key.slice(0, bracketIndex) : key);
            }
            for (const topLevelKey of explicitTopLevelKeys) {
                for (const existingKey of Array.from(baseURL.searchParams.keys())) {
                    if (existingKey === topLevelKey ||
                        existingKey.startsWith(`${topLevelKey}[`)) {
                        baseURL.searchParams.delete(existingKey);
                    }
                }
            }
            for (const [key, value] of explicitBaseQuery.entries()) {
                baseURL.searchParams.append(key, value);
            }
        }
        mergeQueryParamsIntoURL(baseURL, extraQuery);
        return baseURL.toString();
    }
    async #ensureWebSocketConnection(wsURL, headers, signal, requestTimeoutDeadline) {
        const identity = this.#getConnectionIdentity(wsURL, headers);
        if (this.#wsConnection &&
            this.#wsConnectionIdentity &&
            this.#wsConnectionIdentity === identity &&
            this.#wsConnection.isReusable()) {
            return { connection: this.#wsConnection, reused: true };
        }
        await this.#dropWebSocketConnection();
        const connectTimeout = this.#resolveWebSocketRequestTimeout(requestTimeoutDeadline, (configuredTimeoutMs) => `Responses websocket connection timed out before opening after ${configuredTimeoutMs}ms.`);
        this.#wsConnection = await ResponsesWebSocketConnection.connect(wsURL, headers, signal, connectTimeout.timeoutMs, connectTimeout.errorMessage);
        this.#wsConnectionIdentity = identity;
        return { connection: this.#wsConnection, reused: false };
    }
    async #reconnectWebSocketConnection(wsURL, headers, signal, requestTimeoutDeadline) {
        await this.#dropWebSocketConnection();
        throwIfAborted(signal);
        const connection = await this.#ensureWebSocketConnection(wsURL, headers, signal, requestTimeoutDeadline);
        throwIfAborted(signal);
        return connection;
    }
    #getConnectionIdentity(wsURL, headers) {
        const normalizedHeaders = Object.entries(headers)
            .map(([key, value]) => [key.toLowerCase(), value])
            .sort(([leftKey, leftValue], [rightKey, rightValue]) => `${leftKey}:${leftValue}`.localeCompare(`${rightKey}:${rightValue}`));
        return JSON.stringify([wsURL, normalizedHeaders]);
    }
    async #dropWebSocketConnection() {
        const connectionToClose = this.#wsConnection;
        if (!connectionToClose) {
            this.#wsConnectionIdentity = undefined;
            return;
        }
        // Detach cached state before awaiting close so queued requests can proceed
        // without racing against this teardown path.
        this.#wsConnection = undefined;
        this.#wsConnectionIdentity = undefined;
        try {
            await connectionToClose.close();
        }
        catch {
            // Ignore close errors and reset the cached connection.
        }
    }
    async #acquireWebSocketRequestLock(signal, requestTimeoutDeadline) {
        throwIfAborted(signal);
        const queueWaitTimeout = this.#resolveWebSocketRequestTimeout(requestTimeoutDeadline, (configuredTimeoutMs) => `Responses websocket request queue wait timed out after ${configuredTimeoutMs}ms.`);
        const previousLock = this.#wsRequestLock;
        let released = false;
        let resolveOwnLock;
        const ownLock = new Promise((resolve) => {
            resolveOwnLock = resolve;
        });
        const releaseLock = () => {
            if (released) {
                return;
            }
            released = true;
            resolveOwnLock();
        };
        this.#wsRequestLock = previousLock.then(() => ownLock);
        try {
            await withAbortSignal(withTimeout(previousLock, queueWaitTimeout.timeoutMs, queueWaitTimeout.errorMessage), signal);
            throwIfAborted(signal);
            return releaseLock;
        }
        catch (error) {
            releaseLock();
            throw error;
        }
    }
    async #refreshClientApiKey() {
        const clientWithInternals = this._client;
        if (typeof clientWithInternals._callApiKey === 'function') {
            await clientWithInternals._callApiKey();
        }
    }
    #getWebSocketFrameReadTimeoutMs() {
        const clientWithTimeout = this._client;
        const timeoutCandidate = typeof clientWithTimeout.timeout === 'number'
            ? clientWithTimeout.timeout
            : clientWithTimeout._options?.timeout;
        if (typeof timeoutCandidate === 'number') {
            return timeoutCandidate;
        }
        return OpenAI.DEFAULT_TIMEOUT;
    }
    #createWebSocketRequestTimeoutDeadline() {
        const timeoutMs = this.#getWebSocketFrameReadTimeoutMs();
        if (typeof timeoutMs !== 'number' ||
            !Number.isFinite(timeoutMs) ||
            timeoutMs <= 0) {
            return undefined;
        }
        return {
            configuredTimeoutMs: timeoutMs,
            deadlineAtMs: Date.now() + timeoutMs,
        };
    }
    #resolveWebSocketRequestTimeout(requestTimeoutDeadline, errorMessageForConfiguredTimeout) {
        const configuredTimeoutMs = requestTimeoutDeadline?.configuredTimeoutMs ??
            this.#getWebSocketFrameReadTimeoutMs();
        const safeConfiguredTimeoutMs = typeof configuredTimeoutMs === 'number'
            ? configuredTimeoutMs
            : OpenAI.DEFAULT_TIMEOUT;
        const errorMessage = errorMessageForConfiguredTimeout(safeConfiguredTimeoutMs);
        if (!requestTimeoutDeadline) {
            return { timeoutMs: configuredTimeoutMs, errorMessage };
        }
        const remainingTimeoutMs = Math.ceil(requestTimeoutDeadline.deadlineAtMs - Date.now());
        if (remainingTimeoutMs <= 0) {
            throw new Error(errorMessage);
        }
        return { timeoutMs: remainingTimeoutMs, errorMessage };
    }
    async #awaitWebSocketRequestTimedOperation(promise, signal, requestTimeoutDeadline, errorMessageForConfiguredTimeout) {
        const timeout = this.#resolveWebSocketRequestTimeout(requestTimeoutDeadline, errorMessageForConfiguredTimeout);
        return await withAbortSignal(withTimeout(promise, timeout.timeoutMs, timeout.errorMessage), signal);
    }
    async #nextWebSocketFrame(connection, signal, requestTimeoutDeadline) {
        const frameReadTimeout = this.#resolveWebSocketRequestTimeout(requestTimeoutDeadline, (configuredTimeoutMs) => `Responses websocket frame read timed out after ${configuredTimeoutMs}ms.`);
        return await withTimeout(connection.nextFrame(signal), frameReadTimeout.timeoutMs, frameReadTimeout.errorMessage);
    }
}
/**
 * Sending an empty string for instructions can override the prompt parameter.
 * Thus, this method checks if the instructions is an empty string and returns undefined if it is.
 * @param instructions - The instructions to normalize.
 * @returns The normalized instructions.
 */
function normalizeInstructions(instructions) {
    if (typeof instructions === 'string') {
        if (instructions.trim() === '') {
            return undefined;
        }
        return instructions;
    }
    return undefined;
}
function searchParamsToAuthHeaderQuery(searchParams) {
    const query = {};
    let hasEntries = false;
    for (const [key, value] of searchParams.entries()) {
        hasEntries = true;
        const existingValue = query[key];
        if (typeof existingValue === 'undefined') {
            query[key] = value;
            continue;
        }
        if (Array.isArray(existingValue)) {
            existingValue.push(value);
            continue;
        }
        query[key] = [existingValue, value];
    }
    return hasEntries ? query : undefined;
}
function toRequestUsageEntry(usage, endpoint) {
    return new RequestUsage({
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        inputTokensDetails: { ...usage?.input_tokens_details },
        outputTokensDetails: { ...usage?.output_tokens_details },
        endpoint,
    });
}
//# sourceMappingURL=openaiResponsesModel.js.map