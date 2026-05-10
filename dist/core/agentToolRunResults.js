// Per-process, ephemeral map linking a function tool call to its nested
// agent run result within the same run; entry is removed after consumption.
const agentToolRunResults = new WeakMap();
export function saveAgentToolRunResult(toolCall, runResult) {
    if (toolCall) {
        agentToolRunResults.set(toolCall, runResult);
    }
}
export function consumeAgentToolRunResult(toolCall) {
    const runResult = agentToolRunResults.get(toolCall);
    if (runResult) {
        agentToolRunResults.delete(toolCall);
    }
    return runResult;
}
//# sourceMappingURL=agentToolRunResults.js.map