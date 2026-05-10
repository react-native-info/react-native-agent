import { MaxTurnsExceededError, ModelRefusalError } from '../errors';
import { assistant } from '../helpers/message';
import { RunMessageOutputItem } from '../items';
import { RunResult } from '../result';
import { runOutputGuardrails } from './guardrails';
import { getTurnInput } from './items';
import { streamStepItemsToRunResult } from './streaming';
const buildRunData = (state) => ({
    input: state._originalInput,
    newItems: state._generatedItems,
    history: getTurnInput(state._originalInput, state._generatedItems, state._reasoningItemIdPolicy),
    output: getTurnInput([], state._generatedItems, state._reasoningItemIdPolicy),
    rawResponses: state._modelResponses,
    lastAgent: state._currentAgent,
    state,
});
const formatFinalOutput = (agent, finalOutput) => {
    if (agent.outputType === 'text') {
        return String(finalOutput);
    }
    return JSON.stringify(finalOutput);
};
const createFinalOutputItem = (agent, outputText) => new RunMessageOutputItem(assistant(outputText), agent);
export const formatRunErrorFinalOutput = formatFinalOutput;
export const createRunErrorFinalOutputItem = createFinalOutputItem;
export const resolveRunErrorHandler = async ({ error, errorHandlers, context, runData, }) => {
    let handler;
    if (error instanceof MaxTurnsExceededError) {
        handler = errorHandlers?.maxTurns ?? errorHandlers?.default;
    }
    else if (error instanceof ModelRefusalError) {
        handler = errorHandlers?.modelRefusal ?? errorHandlers?.default;
    }
    else {
        return undefined;
    }
    if (!handler) {
        return undefined;
    }
    const handlerResult = await handler({
        error,
        context,
        runData,
    });
    return handlerResult || undefined;
};
export const tryHandleRunError = async ({ error, state, errorHandlers, outputGuardrailDefs, emitAgentEnd, streamResult, }) => {
    const handlerResult = await resolveRunErrorHandler({
        error,
        errorHandlers,
        context: state._context,
        runData: buildRunData(state),
    });
    if (!handlerResult) {
        return undefined;
    }
    const includeInHistory = handlerResult.includeInHistory !== false;
    const outputText = formatFinalOutput(state._currentAgent, handlerResult.finalOutput);
    state._lastTurnResponse = undefined;
    state._lastProcessedResponse = undefined;
    const item = createFinalOutputItem(state._currentAgent, outputText);
    if (includeInHistory) {
        state._generatedItems.push(item);
    }
    if (streamResult) {
        streamStepItemsToRunResult(streamResult, [item]);
    }
    state._currentStep = {
        type: 'next_step_final_output',
        output: outputText,
    };
    state._finalOutputSource = 'error_handler';
    await runOutputGuardrails(state, outputGuardrailDefs, outputText);
    state._currentTurnInProgress = false;
    emitAgentEnd(state._context, state._currentAgent, outputText);
    return new RunResult(state);
};
//# sourceMappingURL=errorHandlers.js.map