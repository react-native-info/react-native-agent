// Internal registry that links Agent.asTool() function tools back to their source
// Agent instances so RunState reconstruction can traverse nested agent-tools
// without storing hidden metadata on the tool object itself.
const agentToolSourceRegistry = new WeakMap();
export function registerAgentToolSourceAgent(tool, agent) {
    agentToolSourceRegistry.set(tool, agent);
}
export function getAgentToolSourceAgent(tool) {
    if (tool.type !== 'function') {
        return undefined;
    }
    return agentToolSourceRegistry.get(tool);
}
//# sourceMappingURL=agentToolSourceRegistry.js.map