import { resolveComputer } from '../tool';
import { serializeHandoff, serializeTool } from '../utils/serialize';
import { ensureAgentSpan } from './tracing';
import { validateClientToolSearchSupport } from './toolSearch';
const computerInitPromisesByRunState = new WeakMap();
function getComputerInitMap(state) {
    let initMap = computerInitPromisesByRunState.get(state);
    if (!initMap) {
        initMap = new WeakMap();
        computerInitPromisesByRunState.set(state, initMap);
    }
    return initMap;
}
async function initComputerOnce(computer, state) {
    if (typeof computer.initRun !== 'function') {
        return;
    }
    const initMap = getComputerInitMap(state);
    const existing = initMap.get(computer);
    if (existing) {
        await existing;
        return;
    }
    const initPromise = (async () => {
        await computer.initRun?.(state._context);
    })();
    initMap.set(computer, initPromise);
    try {
        await initPromise;
    }
    catch (error) {
        initMap.delete(computer);
        throw error;
    }
}
/**
 * Collects tools and handoffs for the current agent so model calls and tracing share the same
 * snapshot of enabled capabilities.
 */
export async function prepareAgentArtifacts(state) {
    const capabilities = await collectAgentCapabilities(state);
    validateClientToolSearchSupport(capabilities.tools);
    await warmUpComputerTools(capabilities.tools, state._context);
    await initializeComputerTools(capabilities.tools, state);
    state.setCurrentAgentSpan(ensureAgentSpan({
        agent: state._currentAgent,
        handoffs: capabilities.handoffs,
        tools: capabilities.tools,
        currentSpan: state._currentAgentSpan,
    }));
    return {
        ...capabilities,
        serializedHandoffs: capabilities.handoffs.map((handoff) => serializeHandoff(handoff)),
        serializedTools: capabilities.tools.map((tool) => serializeTool(tool)),
        toolsExplicitlyProvided: state._currentAgent.hasExplicitToolConfig(),
    };
}
async function collectAgentCapabilities(state) {
    const handoffs = await state._currentAgent.getEnabledHandoffs(state._context);
    const configuredTools = (await state._currentAgent.getAllTools(state._context));
    const runtimeLoadedTools = state.getToolSearchRuntimeTools(state._currentAgent);
    return { handoffs, tools: [...configuredTools, ...runtimeLoadedTools] };
}
async function warmUpComputerTools(tools, runContext) {
    const computerTools = tools.filter((tool) => tool.type === 'computer');
    if (computerTools.length === 0) {
        return;
    }
    await Promise.all(computerTools.map(async (tool) => {
        await resolveComputer({ tool, runContext });
    }));
}
async function initializeComputerTools(tools, state) {
    const computerTools = tools.filter((tool) => tool.type === 'computer');
    if (computerTools.length === 0) {
        return;
    }
    await Promise.all(computerTools.map(async (tool) => {
        const computer = await resolveComputer({
            tool,
            runContext: state._context,
        });
        await initComputerOnce(computer, state);
    }));
}
//# sourceMappingURL=modelPreparation.js.map