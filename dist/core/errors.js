/**
 * Base class for all errors thrown by the library.
 */
export class AgentsError extends Error {
    state;
    constructor(message, state) {
        super(message);
        this.name = new.target.name;
        this.state = state;
    }
}
/**
 * System error thrown when the library encounters an error that is not caused by the user's
 * misconfiguration.
 */
export class SystemError extends AgentsError {
}
/**
 * Error thrown when the maximum number of turns is exceeded.
 */
export class MaxTurnsExceededError extends AgentsError {
}
/**
 * Error thrown when the model refuses to produce output.
 */
export class ModelRefusalError extends AgentsError {
    /**
     * The refusal text returned by the model.
     */
    refusal;
    constructor(refusal, state) {
        super(`Model refused to produce output: ${refusal}`, state);
        this.refusal = refusal;
    }
}
/**
 * Error thrown when a model behavior is unexpected.
 */
export class ModelBehaviorError extends AgentsError {
}
/**
 * Error thrown when a model produces invalid tool input.
 */
export class InvalidToolInputError extends ModelBehaviorError {
    /** The original error thrown during validation, if any. */
    originalError;
    /** Context from the tool invocation that failed. */
    toolInvocation;
    constructor(message, state, originalError, toolInvocation) {
        super(message, state);
        this.originalError = originalError;
        this.toolInvocation = toolInvocation;
    }
}
/**
 * Error thrown when the error is caused by the library user's misconfiguration.
 */
export class UserError extends AgentsError {
}
/**
 * Error thrown when a guardrail execution fails.
 */
export class GuardrailExecutionError extends AgentsError {
    error;
    constructor(message, error, state) {
        super(message, state);
        this.error = error;
    }
}
/**
 * Error thrown when a tool call fails.
 */
export class ToolCallError extends AgentsError {
    error;
    constructor(message, error, state) {
        super(message, state);
        this.error = error;
    }
}
/**
 * Error thrown when a function tool invocation exceeds its timeout.
 */
export class ToolTimeoutError extends AgentsError {
    toolName;
    timeoutMs;
    constructor({ toolName, timeoutMs, state, }) {
        super(`Tool '${toolName}' timed out after ${timeoutMs}ms.`, state);
        this.toolName = toolName;
        this.timeoutMs = timeoutMs;
    }
}
/**
 * Error thrown when an input guardrail tripwire is triggered.
 */
export class InputGuardrailTripwireTriggered extends AgentsError {
    result;
    constructor(message, result, state) {
        super(message, state);
        this.result = result;
    }
}
/**
 * Error thrown when an output guardrail tripwire is triggered.
 */
export class OutputGuardrailTripwireTriggered extends AgentsError {
    result;
    constructor(message, result, state) {
        super(message, state);
        this.result = result;
    }
}
/**
 * Error thrown when a tool input guardrail tripwire is triggered.
 */
export class ToolInputGuardrailTripwireTriggered extends AgentsError {
    result;
    constructor(message, result, state) {
        super(message, state);
        this.result = result;
    }
}
/**
 * Error thrown when a tool output guardrail tripwire is triggered.
 */
export class ToolOutputGuardrailTripwireTriggered extends AgentsError {
    result;
    constructor(message, result, state) {
        super(message, state);
        this.result = result;
    }
}
//# sourceMappingURL=errors.js.map