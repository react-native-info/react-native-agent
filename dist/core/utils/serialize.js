import { UserError } from '../errors';
import { getExplicitFunctionToolNamespace, getFunctionToolNamespaceDescription, } from '../toolIdentity';
const REQUIRED_COMPUTER_METHODS = [
    'screenshot',
    'click',
    'doubleClick',
    'drag',
    'keypress',
    'move',
    'scroll',
    'type',
    'wait',
];
function isComputerInstance(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value;
    return REQUIRED_COMPUTER_METHODS.every((methodName) => typeof record[methodName] === 'function');
}
function hasComputerDisplayMetadata(computer) {
    return (typeof computer.environment === 'string' &&
        Array.isArray(computer.dimensions) &&
        computer.dimensions.length === 2 &&
        computer.dimensions.every((value) => typeof value === 'number'));
}
export function serializeTool(tool) {
    if (tool.type === 'function') {
        const namespace = getExplicitFunctionToolNamespace(tool);
        return {
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict,
            deferLoading: tool.deferLoading,
            ...(namespace ? { namespace } : {}),
            ...(namespace
                ? {
                    namespaceDescription: getFunctionToolNamespaceDescription(tool),
                }
                : {}),
        };
    }
    if (tool.type === 'computer') {
        // When a computer is created lazily via an initializer, serializeTool can be called before initialization (e.g., manual serialize without running the agent).
        if (!isComputerInstance(tool.computer)) {
            throw new UserError('Computer tool is not initialized for serialization. Call resolveComputer({ tool, runContext }) first (for example, when building a model payload outside Runner.run).');
        }
        return {
            type: 'computer',
            name: tool.name,
            ...(hasComputerDisplayMetadata(tool.computer)
                ? {
                    environment: tool.computer.environment,
                    dimensions: tool.computer.dimensions,
                }
                : {}),
        };
    }
    if (tool.type === 'shell') {
        return {
            type: 'shell',
            name: tool.name,
            environment: tool.environment,
        };
    }
    if (tool.type === 'apply_patch') {
        return {
            type: 'apply_patch',
            name: tool.name,
        };
    }
    return {
        type: 'hosted_tool',
        name: tool.name,
        providerData: tool.providerData,
    };
}
export function serializeHandoff(h) {
    return {
        toolName: h.toolName,
        toolDescription: h.toolDescription,
        inputJsonSchema: h.inputJsonSchema,
        strictJsonSchema: h.strictJsonSchema,
    };
}
//# sourceMappingURL=serialize.js.map