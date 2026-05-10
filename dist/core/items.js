import { toSmartString } from './utils/smartString';
import { getFunctionToolQualifiedName, resolveFunctionToolCallName, } from './toolIdentity';
export class RunItemBase {
    type = 'base_item';
    rawItem;
    toJSON() {
        return {
            type: this.type,
            rawItem: this.rawItem,
        };
    }
}
export class RunMessageOutputItem extends RunItemBase {
    rawItem;
    agent;
    type = 'message_output_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
    get content() {
        let content = '';
        for (const part of this.rawItem.content) {
            if (part.type === 'output_text') {
                content += part.text;
            }
        }
        return content;
    }
}
export class RunToolCallItem extends RunItemBase {
    rawItem;
    agent;
    type = 'tool_call_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
    get toolName() {
        return getStringProperty(this.rawItem, 'name');
    }
    get callId() {
        return (getStringProperty(this.rawItem, 'callId') ??
            getStringProperty(this.rawItem, 'id'));
    }
}
export class RunToolSearchCallItem extends RunItemBase {
    rawItem;
    agent;
    type = 'tool_search_call_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
export class RunToolSearchOutputItem extends RunItemBase {
    rawItem;
    agent;
    type = 'tool_search_output_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
export class RunToolCallOutputItem extends RunItemBase {
    rawItem;
    agent;
    output;
    type = 'tool_call_output_item';
    constructor(rawItem, agent, output) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
        this.output = output;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
            output: toSmartString(this.output),
        };
    }
    get callId() {
        return (getStringProperty(this.rawItem, 'callId') ??
            getStringProperty(this.rawItem, 'id'));
    }
}
export class RunReasoningItem extends RunItemBase {
    rawItem;
    agent;
    type = 'reasoning_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
export class RunHandoffCallItem extends RunItemBase {
    rawItem;
    agent;
    type = 'handoff_call_item';
    constructor(rawItem, agent) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
        };
    }
}
export class RunHandoffOutputItem extends RunItemBase {
    rawItem;
    sourceAgent;
    targetAgent;
    type = 'handoff_output_item';
    constructor(rawItem, sourceAgent, targetAgent) {
        super();
        this.rawItem = rawItem;
        this.sourceAgent = sourceAgent;
        this.targetAgent = targetAgent;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            sourceAgent: this.sourceAgent.toJSON(),
            targetAgent: this.targetAgent.toJSON(),
        };
    }
}
export class RunToolApprovalItem extends RunItemBase {
    rawItem;
    agent;
    toolName;
    type = 'tool_approval_item';
    constructor(rawItem, agent, 
    /**
     * Explicit tool name to use for approval tracking when not present on the raw item.
     */
    toolName) {
        super();
        this.rawItem = rawItem;
        this.agent = agent;
        this.toolName = toolName;
        this.toolName = toolName ?? getDefaultApprovalToolName(rawItem, agent);
    }
    /**
     * Returns the tool name if available on the raw item or provided explicitly.
     * Kept for backwards compatibility with code that previously relied on `rawItem.name`.
     */
    get name() {
        return this.toolName ?? this.rawItem.name;
    }
    /**
     * Returns the arguments if the raw item has an arguments property otherwise this will be undefined.
     */
    get arguments() {
        return 'arguments' in this.rawItem ? this.rawItem.arguments : undefined;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            agent: this.agent.toJSON(),
            toolName: this.toolName,
        };
    }
}
function getDefaultApprovalToolName(rawItem, agent) {
    if (rawItem.type !== 'function_call') {
        return rawItem.name;
    }
    const availableFunctionTools = new Map(agent.tools.flatMap((tool) => {
        if (tool.type !== 'function' || typeof tool.name !== 'string') {
            return [];
        }
        return [[getFunctionToolQualifiedName(tool) ?? tool.name, tool]];
    }));
    const resolvedToolName = resolveFunctionToolCallName(rawItem, availableFunctionTools);
    if (typeof rawItem.name === 'string' &&
        typeof rawItem.namespace === 'string' &&
        rawItem.namespace === rawItem.name &&
        !availableFunctionTools.has(`${rawItem.namespace}.${rawItem.name}`)) {
        return rawItem.name;
    }
    return resolvedToolName ?? rawItem.name;
}
function getStringProperty(item, key) {
    const value = item[key];
    return typeof value === 'string' ? value : undefined;
}
/**
 * Extract all text output from a list of run items by concatenating the content of all
 * message output items.
 *
 * @param items - The list of run items to extract text from.
 * @returns A string of all the text output from the run items.
 */
export function extractAllTextOutput(items) {
    return items
        .filter((item) => item.type === 'message_output_item')
        .map((item) => item.content)
        .join('');
}
//# sourceMappingURL=items.js.map