import logger from '../logger';
export const TOOL_APPROVAL_REJECTION_MESSAGE = 'Tool execution was not approved.';
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function resolveApprovalRejectionMessage({ runContext, toolType, toolName, callId, toolErrorFormatter, }) {
    // Per-call message from state.reject(item, { message }) takes precedence over
    // the global toolErrorFormatter callback and the SDK default.
    const perCallMessage = runContext.getRejectionMessage(toolName, callId);
    if (typeof perCallMessage === 'string') {
        return perCallMessage;
    }
    if (!toolErrorFormatter) {
        return TOOL_APPROVAL_REJECTION_MESSAGE;
    }
    try {
        const formattedMessage = await toolErrorFormatter({
            kind: 'approval_rejected',
            toolType,
            toolName,
            callId,
            defaultMessage: TOOL_APPROVAL_REJECTION_MESSAGE,
            runContext,
        });
        if (typeof formattedMessage === 'string') {
            return formattedMessage;
        }
        if (typeof formattedMessage !== 'undefined') {
            logger.warn('toolErrorFormatter returned a non-string value. Falling back to the default tool approval rejection message.');
        }
    }
    catch (error) {
        logger.warn(`toolErrorFormatter threw while formatting approval rejection: ${toErrorMessage(error)}`);
    }
    return TOOL_APPROVAL_REJECTION_MESSAGE;
}
//# sourceMappingURL=approvalRejection.js.map