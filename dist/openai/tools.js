import { attachClientToolSearchExecutor, UserError, } from '../core';
import { z } from 'zod';
// -----------------------------------------------------
// Status enums
// -----------------------------------------------------
export const WebSearchStatus = z
    .enum(['in_progress', 'completed', 'searching', 'failed'])
    .default('failed');
export const FileSearchStatus = z
    .enum(['in_progress', 'completed', 'searching', 'failed', 'incomplete'])
    .default('failed');
export const CodeInterpreterStatus = z
    .enum(['in_progress', 'completed', 'interpreting'])
    .default('in_progress');
export const ImageGenerationStatus = z
    .enum(['in_progress', 'completed', 'generating', 'failed'])
    .default('failed');
/**
 * Adds web search abilities to your agent
 * @param options Additional configuration for the web search like specifying the location of your agent
 * @returns a web search tool definition
 */
export function webSearchTool(options = {}) {
    const providerData = {
        type: 'web_search',
        name: options.name ?? 'web_search',
        user_location: options.userLocation,
        filters: options.filters?.allowedDomains
            ? { allowed_domains: options.filters.allowedDomains }
            : undefined,
        search_context_size: options.searchContextSize ?? 'medium',
    };
    if (options.externalWebAccess !== undefined) {
        providerData.external_web_access = options.externalWebAccess;
    }
    return {
        type: 'hosted_tool',
        name: options.name ?? 'web_search',
        providerData,
    };
}
/**
 * Adds file search abilities to your agent
 * @param vectorStoreIds The IDs of the vector stores to search.
 * @param options Additional configuration for the file search like specifying the maximum number of results to return.
 * @returns a file search tool definition
 */
export function fileSearchTool(vectorStoreIds, options = {}) {
    const vectorIds = Array.isArray(vectorStoreIds)
        ? vectorStoreIds
        : [vectorStoreIds];
    const providerData = {
        type: 'file_search',
        name: options.name ?? 'file_search',
        vector_store_ids: vectorIds,
        max_num_results: options.maxNumResults,
        include_search_results: options.includeSearchResults,
        ranking_options: options.rankingOptions,
        filters: options.filters,
    };
    return {
        type: 'hosted_tool',
        name: options.name ?? 'file_search',
        providerData,
    };
}
/**
 * Adds code interpreter abilities to your agent
 * @param options Additional configuration for the code interpreter
 * @returns a code interpreter tool definition
 */
export function codeInterpreterTool(options = {}) {
    const providerData = {
        type: 'code_interpreter',
        name: options.name ?? 'code_interpreter',
        container: options.container ?? { type: 'auto' },
        include_outputs: options.includeOutputs,
    };
    return {
        type: 'hosted_tool',
        name: options.name ?? 'code_interpreter',
        providerData,
    };
}
/**
 * Adds tool_search capabilities to your agent.
 *
 * This lets the model search deferred function tools and load them into context on demand.
 * By default, tool search is executed by OpenAI. Set `execution: 'client'` to
 * use a custom loop that receives `tool_search_call` / `tool_search_output`
 * items. The standard runner only supports the default built-in client schema
 * (leave `parameters` unset) and auto-executes `{ paths: string[] }` searches
 * over deferred top-level function tools and deferred namespace members.
 *
 * @returns a hosted tool_search definition.
 */
export function toolSearchTool(options = {}) {
    if (typeof options.name === 'string' && options.name !== 'tool_search') {
        throw new UserError('toolSearchTool() only supports the canonical built-in name "tool_search".');
    }
    if (typeof options.execute === 'function' && options.execution !== 'client') {
        throw new UserError('toolSearchTool() only supports execute when execution is "client".');
    }
    const providerData = {
        type: 'tool_search',
        name: 'tool_search',
        execution: options.execution,
        description: options.description,
        parameters: options.parameters,
    };
    const hostedTool = {
        type: 'hosted_tool',
        name: 'tool_search',
        providerData,
    };
    if (typeof options.execute === 'function') {
        attachClientToolSearchExecutor(hostedTool, options.execute);
    }
    return hostedTool;
}
/**
 * Adds image generation abilities to your agent
 * @param options Additional configuration for the image generation
 * @returns an image generation tool definition
 */
export function imageGenerationTool(options = {}) {
    const providerData = {
        type: 'image_generation',
        name: options.name ?? 'image_generation',
        background: options.background,
        input_fidelity: options.inputFidelity,
        input_image_mask: options.inputImageMask,
        model: options.model,
        moderation: options.moderation,
        output_compression: options.outputCompression,
        output_format: options.outputFormat,
        partial_images: options.partialImages,
        quality: options.quality,
        size: options.size,
    };
    return {
        type: 'hosted_tool',
        name: options.name ?? 'image_generation',
        providerData,
    };
}
// HostedMCPTool exists in agents-core package
//# sourceMappingURL=tools.js.map