import { RunHandoffCallItem, RunHandoffOutputItem, RunReasoningItem, RunToolApprovalItem, RunToolCallItem, RunToolCallOutputItem, RunToolSearchCallItem, RunToolSearchOutputItem, } from '../items';
const TOOL_TYPES = new Set([
    'function_call',
    'function_call_result',
    'tool_search_call',
    'tool_search_output',
    'computer_call',
    'computer_call_result',
    'shell_call',
    'shell_call_output',
    'apply_patch_call',
    'apply_patch_call_output',
    'hosted_tool_call',
    'reasoning',
]);
/**
 * Filters out tool-related history and run items before a handoff.
 *
 * @param handoffInputData The collected handoff input to sanitize.
 * @returns Handoff input without tool calls, tool outputs, or tool search items.
 */
export function removeAllTools(handoffInputData) {
    const { inputHistory, preHandoffItems, newItems, runContext } = handoffInputData;
    const filteredHistory = Array.isArray(inputHistory)
        ? removeToolTypesFromInput(inputHistory)
        : inputHistory;
    const filteredPreHandoffItems = removeToolsFromItems(preHandoffItems);
    const filteredNewItems = removeToolsFromItems(newItems);
    return {
        inputHistory: filteredHistory,
        preHandoffItems: filteredPreHandoffItems,
        newItems: filteredNewItems,
        runContext,
    };
}
function removeToolsFromItems(items) {
    return items.filter((item) => !(item instanceof RunHandoffCallItem) &&
        !(item instanceof RunHandoffOutputItem) &&
        !(item instanceof RunToolSearchCallItem) &&
        !(item instanceof RunToolSearchOutputItem) &&
        !(item instanceof RunToolCallItem) &&
        !(item instanceof RunToolCallOutputItem) &&
        !(item instanceof RunReasoningItem) &&
        !(item instanceof RunToolApprovalItem));
}
function removeToolTypesFromInput(items) {
    return items.filter((item) => !TOOL_TYPES.has(item.type ?? ''));
}
//# sourceMappingURL=handoffFilters.js.map