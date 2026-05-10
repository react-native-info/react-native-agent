function getAssistantMessage(outputMessage) {
    if (outputMessage.type !== 'message') {
        return null;
    }
    if (!('role' in outputMessage) || outputMessage.role !== 'assistant') {
        return null;
    }
    return outputMessage;
}
/**
 * Get the last text from the output message.
 * @param outputMessage
 * @returns
 */
export function getLastTextFromOutputMessage(outputMessage) {
    const assistantMessage = getAssistantMessage(outputMessage);
    if (!assistantMessage) {
        return undefined;
    }
    const lastItem = assistantMessage.content[assistantMessage.content.length - 1];
    if (lastItem.type !== 'output_text') {
        return undefined;
    }
    return lastItem.text;
}
/**
 * Get all text from the output message.
 * @param outputMessage
 * @returns
 */
export function getTextFromOutputMessage(outputMessage) {
    const assistantMessage = getAssistantMessage(outputMessage);
    if (!assistantMessage) {
        return undefined;
    }
    let sawText = false;
    const text = assistantMessage.content.reduce((acc, item) => {
        if (item.type !== 'output_text') {
            return acc;
        }
        sawText = true;
        return acc + item.text;
    }, '');
    return sawText ? text : undefined;
}
/**
 * Get all refusal text from the output message.
 * @param outputMessage
 * @returns
 */
export function getRefusalFromOutputMessage(outputMessage) {
    const assistantMessage = getAssistantMessage(outputMessage);
    if (!assistantMessage) {
        return undefined;
    }
    let sawRefusal = false;
    const refusal = assistantMessage.content.reduce((acc, item) => {
        if (item.type !== 'refusal') {
            return acc;
        }
        sawRefusal = true;
        return acc + item.refusal;
    }, '');
    return sawRefusal ? refusal : undefined;
}
/**
 * Get the last text from the output message.
 * @param output
 * @returns
 */
export function getOutputText(output) {
    if (output.output.length === 0) {
        return '';
    }
    return (getTextFromOutputMessage(output.output[output.output.length - 1]) || '');
}
//# sourceMappingURL=messages.js.map