import { Runner } from '../core';
import { OpenAIProvider } from './openaiProvider';
function attachCleanupErrorToThrownError(callbackError, cleanupError) {
    if (!(callbackError instanceof Error)) {
        return;
    }
    const callbackErrorWithMetadata = callbackError;
    if (typeof callbackErrorWithMetadata.cause === 'undefined') {
        callbackErrorWithMetadata.cause = cleanupError;
        return;
    }
    callbackErrorWithMetadata.cleanupError = cleanupError;
}
/**
 * Runs a callback within a session-scoped Responses API websocket provider/runner and closes the
 * provider afterwards so websocket connections do not keep the process alive.
 */
export async function withResponsesWebSocketSession(callback, options = {}) {
    const provider = new OpenAIProvider({
        ...(options.providerOptions ?? {}),
        useResponses: true,
        useResponsesWebSocket: true,
    });
    const runner = new Runner({
        ...(options.runnerConfig ?? {}),
        modelProvider: provider,
    });
    const run = runner.run.bind(runner);
    let callbackFailed = false;
    let callbackError;
    let callbackResult;
    try {
        callbackResult = await callback({ provider, runner, run });
    }
    catch (error) {
        callbackFailed = true;
        callbackError = error;
    }
    try {
        await provider.close();
    }
    catch (closeError) {
        if (!callbackFailed) {
            throw closeError;
        }
        attachCleanupErrorToThrownError(callbackError, closeError);
    }
    if (callbackFailed) {
        throw callbackError;
    }
    return callbackResult;
}
//# sourceMappingURL=responsesWebSocketSession.js.map