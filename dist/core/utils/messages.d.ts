import { ResponseOutputItem } from '../types';
import { ModelResponse } from '../model';
/**
 * Get the last text from the output message.
 * @param outputMessage
 * @returns
 */
export declare function getLastTextFromOutputMessage(outputMessage: ResponseOutputItem): string | undefined;
/**
 * Get all text from the output message.
 * @param outputMessage
 * @returns
 */
export declare function getTextFromOutputMessage(outputMessage: ResponseOutputItem): string | undefined;
/**
 * Get all refusal text from the output message.
 * @param outputMessage
 * @returns
 */
export declare function getRefusalFromOutputMessage(outputMessage: ResponseOutputItem): string | undefined;
/**
 * Get the last text from the output message.
 * @param output
 * @returns
 */
export declare function getOutputText(output: ModelResponse): string;
