import { HandoffInputData } from '../handoff';
/**
 * Filters out tool-related history and run items before a handoff.
 *
 * @param handoffInputData The collected handoff input to sanitize.
 * @returns Handoff input without tool calls, tool outputs, or tool search items.
 */
export declare function removeAllTools(handoffInputData: HandoffInputData): HandoffInputData;
