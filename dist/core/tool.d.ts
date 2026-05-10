import type { Agent } from './agent';
import type { Computer } from './computer';
import type { Shell, ShellAction } from './shell';
import type { Editor, ApplyPatchOperation } from './editor';
import { JsonObjectSchema, JsonObjectSchemaNonStrict, JsonObjectSchemaStrict, UnknownContext } from './types';
import { RunContext } from './runContext';
import type { RunConfig } from './run';
import type { RunResult } from './result';
import { ToolTimeoutError } from './errors';
import { RunToolApprovalItem, RunToolCallOutputItem } from './items';
import * as ProviderData from './types/providerData';
import * as protocol from './types/protocol';
import type { ZodInfer, ZodObjectLike } from './utils/zodCompat';
import { ToolInputGuardrailDefinition, ToolOutputGuardrailDefinition, ToolInputGuardrailFunction, ToolOutputGuardrailFunction } from './toolGuardrail';
export type { ToolOutputText, ToolOutputImage, ToolOutputFileContent, ToolCallStructuredOutput, ToolCallOutputContent, } from './types/protocol';
/**
 * A function that determines if a tool call should be approved.
 *
 * @param runContext The current run context
 * @param input The input to the tool
 * @param callId The ID of the tool call
 * @returns True if the tool call should be approved, false otherwise
 */
export type ToolApprovalFunction<TParameters extends ToolInputParameters> = (runContext: RunContext, input: ToolExecuteArgument<TParameters>, callId?: string) => Promise<boolean>;
export type ToolCallDetails = {
    toolCall?: protocol.FunctionCallItem;
    resumeState?: string;
    signal?: AbortSignal;
    /**
     * Internal: parent runner config for nested agent-tool runs (Agent.asTool).
     */
    parentRunConfig?: Partial<RunConfig>;
};
export type FunctionToolTimeoutBehavior = 'error_as_result' | 'raise_exception';
export type ToolTimeoutErrorFunction<Context = UnknownContext> = (context: RunContext<Context>, error: ToolTimeoutError) => Promise<string> | string;
export type ShellApprovalFunction = (runContext: RunContext, action: ShellAction, callId?: string) => Promise<boolean>;
export type ShellOnApprovalFunction = (runContext: RunContext, approvalItem: RunToolApprovalItem) => Promise<{
    approve: boolean;
    reason?: string;
}>;
export type ShellToolLocalSkill = {
    description: string;
    name: string;
    path: string;
};
export type ShellToolSkillReference = {
    type: 'skill_reference';
    skillId: string;
    version?: string;
};
export type ShellToolInlineSkillSource = {
    data: string;
    mediaType: 'application/zip';
    type: 'base64';
};
export type ShellToolInlineSkill = {
    description: string;
    name: string;
    source: ShellToolInlineSkillSource;
    type: 'inline';
};
export type ShellToolContainerSkill = ShellToolSkillReference | ShellToolInlineSkill;
export type ShellToolContainerNetworkPolicyDomainSecret = {
    domain: string;
    name: string;
    value: string;
};
export type ShellToolContainerNetworkPolicyAllowlist = {
    allowedDomains: string[];
    domainSecrets?: ShellToolContainerNetworkPolicyDomainSecret[];
    type: 'allowlist';
};
export type ShellToolContainerNetworkPolicyDisabled = {
    type: 'disabled';
};
export type ShellToolContainerNetworkPolicy = ShellToolContainerNetworkPolicyAllowlist | ShellToolContainerNetworkPolicyDisabled;
export type ShellToolLocalEnvironment = {
    type: 'local';
    skills?: ShellToolLocalSkill[];
};
export type ShellToolContainerAutoEnvironment = {
    type: 'container_auto';
    fileIds?: string[];
    memoryLimit?: '1g' | '4g' | '16g' | '64g' | null;
    networkPolicy?: ShellToolContainerNetworkPolicy;
    skills?: ShellToolContainerSkill[];
};
export type ShellToolContainerReferenceEnvironment = {
    type: 'container_reference';
    containerId: string;
};
export type ShellToolHostedEnvironment = ShellToolContainerAutoEnvironment | ShellToolContainerReferenceEnvironment;
export type ShellToolEnvironment = ShellToolLocalEnvironment | ShellToolHostedEnvironment;
export type ApplyPatchApprovalFunction = (runContext: RunContext, operation: ApplyPatchOperation, callId?: string) => Promise<boolean>;
export type ApplyPatchOnApprovalFunction = (runContext: RunContext, approvalItem: RunToolApprovalItem) => Promise<{
    approve: boolean;
    reason?: string;
}>;
export type ComputerApprovalFunction = (runContext: RunContext, action: protocol.ComputerAction, callId?: string) => Promise<boolean>;
export type ComputerSafetyCheck = {
    id: string;
    code: string;
    message?: string;
    [key: string]: unknown;
};
export type ComputerSafetyCheckResult = void | boolean | {
    acknowledgedSafetyChecks: ComputerSafetyCheck[];
} | {
    acknowledged_safety_checks: ComputerSafetyCheck[];
};
export type ComputerOnSafetyCheckFunction = (args: {
    runContext: RunContext;
    pendingSafetyChecks: ComputerSafetyCheck[];
    toolCall: protocol.ComputerUseCallItem;
}) => Promise<ComputerSafetyCheckResult>;
export type ToolEnabledFunction<Context = UnknownContext> = (runContext: RunContext<Context>, agent: Agent<any, any>) => Promise<boolean>;
type ToolEnabledPredicate<Context = UnknownContext> = (args: {
    runContext: RunContext<Context>;
    agent: Agent<any, any>;
}) => boolean | Promise<boolean>;
type ToolEnabledOption<Context = UnknownContext> = boolean | ToolEnabledPredicate<Context>;
/**
 * Exposes a function to the agent as a tool to be called
 *
 * @param Context The context of the tool
 * @param Result The result of the tool
 */
export type FunctionTool<Context = UnknownContext, TParameters extends ToolInputParameters = undefined, Result = unknown> = {
    type: 'function';
    /**
     * The name of the tool.
     */
    name: string;
    /**
     * The description of the tool that helps the model to understand when to use the tool
     */
    description: string;
    /**
     * A JSON schema describing the parameters of the tool.
     */
    parameters: JsonObjectSchema<any>;
    /**
     * Whether the tool is strict. If true, the model must try to strictly follow the schema (might result in slower response times).
     */
    strict: boolean;
    /**
     * Responses API only. Hides a top-level function tool definition until tool search loads it.
     */
    deferLoading?: boolean;
    /**
     * The function to invoke when the tool is called.
     */
    invoke: (runContext: RunContext<Context>, input: string, details?: ToolCallDetails) => Promise<string | Result>;
    /**
     * Whether the tool needs human approval before it can be called. If this is true, the run will result in an `interruption` that the
     * program has to resolve by approving or rejecting the tool call.
     */
    needsApproval: ToolApprovalFunction<TParameters>;
    /**
     * Optional timeout in milliseconds for each tool invocation.
     */
    timeoutMs?: number;
    /**
     * Defines how timeout errors are handled.
     *
     * - `error_as_result`: return a model-visible timeout message.
     * - `raise_exception`: raise `ToolTimeoutError` and fail the run.
     */
    timeoutBehavior?: FunctionToolTimeoutBehavior;
    /**
     * Optional formatter for timeout errors when timeoutBehavior is `error_as_result`.
     */
    timeoutErrorFunction?: ToolTimeoutErrorFunction<Context>;
    /**
     * Determines whether the tool should be made available to the model for the current run.
     */
    isEnabled: ToolEnabledFunction<Context>;
    /**
     * Guardrails that run before the tool executes.
     */
    inputGuardrails?: ToolInputGuardrailDefinition<Context>[];
    /**
     * Guardrails that run after the tool executes.
     */
    outputGuardrails?: ToolOutputGuardrailDefinition<Context>[];
};
/**
 * Arguments provided to computer initializers.
 */
export type ComputerInitializerArgs<Context = UnknownContext> = {
    runContext: RunContext<Context>;
};
/**
 * A function that initializes a computer for the current run.
 */
type BivariantComputerCreate<Context = UnknownContext, TComputer extends Computer = Computer> = {
    bivarianceHack: (args: ComputerInitializerArgs<Context>) => TComputer | Promise<TComputer>;
}['bivarianceHack'];
export type ComputerCreate<Context = UnknownContext, TComputer extends Computer = Computer> = BivariantComputerCreate<Context, TComputer>;
/**
 * Optional cleanup invoked after a run finishes when the computer was created via an initializer.
 */
type BivariantComputerDispose<Context = UnknownContext, TComputer extends Computer = Computer> = {
    bivarianceHack: (args: ComputerInitializerArgs<Context> & {
        computer: TComputer;
    }) => void | Promise<void>;
}['bivarianceHack'];
export type ComputerDispose<Context = UnknownContext, TComputer extends Computer = Computer> = BivariantComputerDispose<Context, TComputer>;
/**
 * Initializes a computer for the current run and optionally tears it down after the run.
 */
export type ComputerProvider<Context = UnknownContext, TComputer extends Computer = Computer> = {
    create: ComputerCreate<Context, TComputer>;
    dispose?: ComputerDispose<Context, TComputer>;
};
type ComputerInitializer<Context = UnknownContext, TComputer extends Computer = Computer> = ComputerCreate<Context, TComputer> | ComputerProvider<Context, TComputer>;
export type ComputerConfig<Context = UnknownContext, TComputer extends Computer = Computer> = Computer | ComputerInitializer<Context, TComputer>;
/**
 * Exposes a computer to the model as a tool to be called
 *
 * @param Context The context of the tool
 * @param Result The result of the tool
 */
export type ComputerTool<Context = UnknownContext, TComputer extends Computer = Computer> = {
    type: 'computer';
    /**
     * The name of the tool.
     */
    name: 'computer_use_preview' | (string & {});
    /**
     * The computer to use.
     */
    computer: ComputerConfig<Context, TComputer>;
    /**
     * Predicate determining whether this computer action requires approval.
     */
    needsApproval: ComputerApprovalFunction;
    /**
     * Optional handler to acknowledge pending safety checks.
     */
    onSafetyCheck?: ComputerOnSafetyCheckFunction;
};
/**
 * Exposes a computer to the agent as a tool to be called.
 *
 * @param options Additional configuration for the computer tool like specifying the location of your agent
 * @returns a computer tool definition
 */
export declare function computerTool<Context = UnknownContext, TComputer extends Computer = Computer>(options: {
    name?: string;
    computer: ComputerConfig<Context, TComputer>;
    needsApproval?: boolean | ComputerApprovalFunction;
    onSafetyCheck?: ComputerOnSafetyCheckFunction;
}): ComputerTool<Context, TComputer>;
/**
 * Returns a computer instance for the provided run context. Caches per run to avoid sharing across runs.
 * @internal
 */
export declare function resolveComputer<Context, TComputer extends Computer = Computer>(args: {
    tool: ComputerTool<Context, TComputer>;
    runContext: RunContext<Context>;
}): Promise<TComputer>;
/**
 * Disposes any computer instances created for the provided run context.
 * @internal
 */
export declare function disposeResolvedComputers<Context>({ runContext, }: {
    runContext: RunContext<Context>;
}): Promise<void>;
type ShellToolBase = {
    type: 'shell';
    /**
     * Public name exposed to the model. Defaults to `shell`.
     */
    name: string;
    /**
     * Predicate determining whether this shell action requires approval.
     */
    needsApproval: ShellApprovalFunction;
    /**
     * Optional handler to auto-approve or reject when approval is required.
     * If provided, it will be invoked immediately when an approval is needed.
     */
    onApproval?: ShellOnApprovalFunction;
};
type LocalShellTool = ShellToolBase & {
    /**
     * Optional for backward compatibility with direct `ShellTool` literals.
     * When omitted, local mode is assumed.
     */
    environment?: ShellToolLocalEnvironment;
    /**
     * The shell implementation to execute commands in local mode.
     */
    shell: Shell;
};
type NormalizedLocalShellTool = Omit<LocalShellTool, 'environment'> & {
    environment: ShellToolLocalEnvironment;
};
type HostedShellTool = ShellToolBase & {
    environment: ShellToolHostedEnvironment;
    /**
     * Hosted environments do not accept local shell implementations.
     */
    shell?: never;
};
export type ShellTool = LocalShellTool | HostedShellTool;
type LocalShellToolOptions = {
    name?: string;
    environment?: ShellToolLocalEnvironment;
    shell: Shell;
    needsApproval?: boolean | ShellApprovalFunction;
    onApproval?: ShellOnApprovalFunction;
};
type HostedShellToolOptions = {
    name?: string;
    environment: ShellToolHostedEnvironment;
    shell?: never;
    needsApproval?: never;
    onApproval?: never;
};
export declare function shellTool(options: LocalShellToolOptions): NormalizedLocalShellTool;
export declare function shellTool(options: HostedShellToolOptions): HostedShellTool;
export type ApplyPatchTool = {
    type: 'apply_patch';
    /**
     * Public name exposed to the model. Defaults to `apply_patch`.
     */
    name: string;
    /**
     * Diff applier invoked when the tool is called.
     */
    editor: Editor;
    /**
     * Predicate determining whether this apply_patch operation requires approval.
     */
    needsApproval: ApplyPatchApprovalFunction;
    /**
     * Optional handler to auto-approve or reject when approval is required.
     */
    onApproval?: ApplyPatchOnApprovalFunction;
};
export declare function applyPatchTool(options: Partial<Omit<ApplyPatchTool, 'type' | 'editor' | 'needsApproval'>> & {
    editor: Editor;
    needsApproval?: boolean | ApplyPatchApprovalFunction;
    onApproval?: ApplyPatchOnApprovalFunction;
}): ApplyPatchTool;
export type HostedMCPApprovalFunction<Context = UnknownContext> = (context: RunContext<Context>, data: RunToolApprovalItem) => Promise<{
    approve: boolean;
    reason?: string;
}>;
/**
 * A hosted MCP tool that lets the model call a remote MCP server directly
 * without a round trip back to your code.
 */
export type HostedMCPTool<Context = UnknownContext> = HostedTool & {
    name: 'hosted_mcp';
    providerData: ProviderData.HostedMCPTool<Context>;
};
/**
 * Creates a hosted MCP tool definition.
 *
 * @param options - Configuration for the hosted MCP tool, including server connection details
 * and approval requirements.
 */
export declare function hostedMcpTool<Context = UnknownContext>(options: {
    allowedTools?: string[] | {
        toolNames?: string[];
    };
    deferLoading?: boolean;
    serverDescription?: string;
} & ({
    serverLabel: string;
    serverUrl?: string;
    authorization?: string;
    headers?: Record<string, string>;
} | {
    serverLabel: string;
    connectorId: string;
    authorization?: string;
    headers?: Record<string, string>;
}) & ({
    requireApproval?: never;
} | {
    requireApproval: 'never';
} | {
    requireApproval: 'always' | {
        never?: {
            toolNames: string[];
        };
        always?: {
            toolNames: string[];
        };
    };
    onApproval?: HostedMCPApprovalFunction<Context>;
})): HostedMCPTool<Context>;
/**
 * A built-in hosted tool that will be executed directly by the model during the request and won't result in local code executions.
 * Examples of these are `web_search_call` or `file_search_call`.
 *
 * @param Context The context of the tool
 * @param Result The result of the tool
 */
export type HostedTool = {
    type: 'hosted_tool';
    /**
     * A unique name for the tool.
     */
    name: string;
    /**
     * Additional configuration data that gets passed to the tool
     */
    providerData?: Record<string, any>;
};
export type ClientToolSearchLoadDefaultFunction<Context = UnknownContext> = (paths: string[]) => Tool<Context>[];
export type ClientToolSearchExecutorArgs<Context = UnknownContext> = {
    agent: Agent<Context, any>;
    availableTools: Tool<Context>[];
    loadDefault: ClientToolSearchLoadDefaultFunction<Context>;
    runContext: RunContext<Context>;
    toolCall: protocol.ToolSearchCallItem;
};
export type ClientToolSearchExecutorResult<Context = UnknownContext> = Tool<Context> | Tool<Context>[] | null | undefined;
export type ClientToolSearchExecutor<Context = UnknownContext> = (args: ClientToolSearchExecutorArgs<Context>) => ClientToolSearchExecutorResult<Context> | Promise<ClientToolSearchExecutorResult<Context>>;
export declare const CLIENT_TOOL_SEARCH_EXECUTOR: unique symbol;
export declare function attachClientToolSearchExecutor<Context = UnknownContext>(tool: HostedTool, executor: ClientToolSearchExecutor<Context>): HostedTool;
export declare function getClientToolSearchExecutor<Context = UnknownContext>(tool: Tool<Context>): ClientToolSearchExecutor<Context> | undefined;
export declare function getToolSearchRuntimeToolKey<Context = UnknownContext>(tool: Tool<Context>): string | undefined;
/**
 * A tool that can be called by the model.
 * @template Context The context passed to the tool
 */
export type Tool<Context = unknown> = FunctionTool<Context, any, any> | ComputerTool<Context, any> | ShellTool | ApplyPatchTool | HostedTool;
/**
 * The result of invoking a function tool. Either the actual output of the execution or a tool
 * approval request.
 *
 * These get passed for example to the `toolUseBehavior` option of the `Agent` constructor.
 */
export type FunctionToolResult<Context = UnknownContext, TParameters extends ToolInputParameters = any, Result = any> = {
    type: 'function_output';
    /**
     * The tool that was called.
     */
    tool: FunctionTool<Context, TParameters, Result>;
    /**
     * The output of the tool call. This can be a string or a stringifable item.
     */
    output: string | unknown;
    /**
     * The run item representing the tool call output.
     */
    runItem: RunToolCallOutputItem;
    /**
     * The result returned when the tool execution runs another agent. Populated when the
     * invocation originated from {@link Agent.asTool} and the nested agent completed a run.
     */
    agentRunResult?: RunResult<Context, Agent<Context, any>>;
    /**
     * Any interruptions collected while the nested agent executed. These are surfaced to allow
     * callers to pause and resume workflows that require approvals.
     */
    interruptions?: RunToolApprovalItem[];
} | {
    /**
     * Indicates that the tool requires approval before it can be called.
     */
    type: 'function_approval';
    /**
     * The tool that is requiring to be approved.
     */
    tool: FunctionTool<Context, TParameters, Result>;
    /**
     * The item representing the tool call that is requiring approval.
     */
    runItem: RunToolApprovalItem;
} | {
    /**
     * Indicates that the tool requires approval before it can be called.
     */
    type: 'hosted_mcp_tool_approval';
    /**
     * The tool that is requiring to be approved.
     */
    tool: HostedMCPTool<Context>;
    /**
     * The item representing the tool call that is requiring approval.
     */
    runItem: RunToolApprovalItem;
};
/**
 * The parameters of a tool.
 *
 * This can be a Zod schema, a JSON schema or undefined.
 *
 * If a Zod schema is provided, the arguments to the tool will automatically be parsed and validated
 * against the schema.
 *
 * If a JSON schema is provided, the arguments to the tool will be passed as is.
 *
 * If undefined is provided, the arguments to the tool will be passed as a string.
 */
export type ToolInputParameters = undefined | ZodObjectLike | JsonObjectSchema<any>;
/**
 * The parameters of a tool that has strict mode enabled.
 *
 * This can be a Zod schema, a JSON schema or undefined.
 *
 * If a Zod schema is provided, the arguments to the tool will automatically be parsed and validated
 * against the schema.
 *
 * If a JSON schema is provided, the arguments to the tool will be parsed as JSON but not validated.
 *
 * If undefined is provided, the arguments to the tool will be passed as a string.
 */
export type ToolInputParametersStrict = undefined | ZodObjectLike | JsonObjectSchemaStrict<any>;
/**
 * The parameters of a tool that has strict mode disabled.
 *
 * If a JSON schema is provided, the arguments to the tool will be parsed as JSON but not validated.
 *
 * Zod schemas are not supported without strict: true.
 */
export type ToolInputParametersNonStrict = undefined | JsonObjectSchemaNonStrict<any>;
/**
 * The arguments to a tool.
 *
 * The type of the arguments are derived from the parameters passed to the tool definition.
 *
 * If the parameters are passed as a JSON schema the type is `unknown`. For Zod schemas it will
 * match the inferred Zod type. Otherwise the type is `string`
 */
export type ToolExecuteArgument<TParameters extends ToolInputParameters> = TParameters extends ZodObjectLike ? ZodInfer<TParameters> : TParameters extends JsonObjectSchema<any> ? unknown : string;
/**
 * The function to invoke when the tool is called.
 *
 * @param input The arguments to the tool (see ToolExecuteArgument)
 * @param context An instance of the current RunContext
 */
type ToolExecuteFunction<TParameters extends ToolInputParameters, Context = UnknownContext> = (input: ToolExecuteArgument<TParameters>, context?: RunContext<Context>, details?: ToolCallDetails) => Promise<unknown> | unknown;
/**
 * The function to invoke when an error occurs while running the tool. This can be used to define
 * what the model should receive as tool output in case of an error. It can be used to provide
 * for example additional context or a fallback value.
 *
 * @param context An instance of the current RunContext
 * @param error The error that occurred
 */
type ToolErrorFunction = (context: RunContext, error: Error | unknown) => Promise<string> | string;
type ToolGuardrailOptions<Context = UnknownContext> = {
    /**
     * Guardrails that validate or block tool invocation before it runs.
     */
    inputGuardrails?: ToolInputGuardrailDefinition<Context>[] | {
        name: string;
        run: ToolInputGuardrailFunction<Context>;
    }[];
    /**
     * Guardrails that validate or alter tool output after it runs.
     */
    outputGuardrails?: ToolOutputGuardrailDefinition<Context>[] | {
        name: string;
        run: ToolOutputGuardrailFunction<Context>;
    }[];
};
/**
 * The options for a tool that has strict mode enabled.
 *
 * @param TParameters The parameters of the tool
 * @param Context The context of the tool
 */
type StrictToolOptions<TParameters extends ToolInputParametersStrict, Context = UnknownContext> = ToolGuardrailOptions<Context> & {
    /**
     * The name of the tool. Must be unique within the agent.
     */
    name?: string;
    /**
     * The description of the tool. This is used to help the model understand when to use the tool.
     */
    description: string;
    /**
     * A Zod schema or JSON schema describing the parameters of the tool.
     * If a Zod schema is provided, the arguments to the tool will automatically be parsed and validated
     * against the schema.
     */
    parameters: TParameters;
    /**
     * Whether the tool is strict. If true, the model must try to strictly follow the schema (might result in slower response times).
     */
    strict?: true;
    /**
     * Responses API only. Hides a top-level function tool definition until tool search loads it.
     */
    deferLoading?: boolean;
    /**
     * The function to invoke when the tool is called.
     */
    execute: ToolExecuteFunction<TParameters, Context>;
    /**
     * The function to invoke when an error occurs while running the tool.
     */
    errorFunction?: ToolErrorFunction | null;
    /**
     * Whether the tool needs human approval before it can be called. If this is true, the run will result in an `interruption` that the
     * program has to resolve by approving or rejecting the tool call.
     */
    needsApproval?: boolean | ToolApprovalFunction<TParameters>;
    /**
     * Determines whether the tool should be exposed to the model for the current run.
     */
    isEnabled?: ToolEnabledOption<Context>;
    /**
     * Optional timeout in milliseconds for each tool call.
     */
    timeoutMs?: number;
    /**
     * Timeout handling mode. `error_as_result` returns a model-visible message and
     * `raise_exception` throws `ToolTimeoutError`.
     */
    timeoutBehavior?: FunctionToolTimeoutBehavior;
    /**
     * Optional formatter used for timeout messages when timeoutBehavior is `error_as_result`.
     */
    timeoutErrorFunction?: ToolTimeoutErrorFunction<Context>;
};
/**
 * The options for a tool that has strict mode disabled.
 *
 * @param TParameters The parameters of the tool
 * @param Context The context of the tool
 */
type NonStrictToolOptions<TParameters extends ToolInputParametersNonStrict, Context = UnknownContext> = ToolGuardrailOptions<Context> & {
    /**
     * The name of the tool. Must be unique within the agent.
     */
    name?: string;
    /**
     * The description of the tool. This is used to help the model understand when to use the tool.
     */
    description: string;
    /**
     * A JSON schema of the tool. To use a Zod schema, you need to use a `strict` schema.
     */
    parameters: TParameters;
    /**
     * Whether the tool is strict  If true, the model must try to strictly follow the schema (might result in slower response times).
     */
    strict: false;
    /**
     * Responses API only. Hides a top-level function tool definition until tool search loads it.
     */
    deferLoading?: boolean;
    /**
     * The function to invoke when the tool is called.
     */
    execute: ToolExecuteFunction<TParameters, Context>;
    /**
     * The function to invoke when an error occurs while running the tool.
     */
    errorFunction?: ToolErrorFunction | null;
    /**
     * Whether the tool needs human approval before it can be called. If this is true, the run will result in an `interruption` that the
     * program has to resolve by approving or rejecting the tool call.
     */
    needsApproval?: boolean | ToolApprovalFunction<TParameters>;
    /**
     * Determines whether the tool should be exposed to the model for the current run.
     */
    isEnabled?: ToolEnabledOption<Context>;
    /**
     * Optional timeout in milliseconds for each tool call.
     */
    timeoutMs?: number;
    /**
     * Timeout handling mode. `error_as_result` returns a model-visible message and
     * `raise_exception` throws `ToolTimeoutError`.
     */
    timeoutBehavior?: FunctionToolTimeoutBehavior;
    /**
     * Optional formatter used for timeout messages when timeoutBehavior is `error_as_result`.
     */
    timeoutErrorFunction?: ToolTimeoutErrorFunction<Context>;
};
/**
 * The options for a tool.
 *
 * @param TParameters The parameters of the tool
 * @param Context The context of the tool
 */
export type ToolOptions<TParameters extends ToolInputParameters, Context = UnknownContext> = StrictToolOptions<Extract<TParameters, ToolInputParametersStrict>, Context> | NonStrictToolOptions<Extract<TParameters, ToolInputParametersNonStrict>, Context>;
export type ToolOptionsWithGuardrails<TParameters extends ToolInputParameters, Context = UnknownContext> = ToolOptions<TParameters, Context>;
type AnyFunctionTool = FunctionTool<any, any, any>;
type FunctionToolInvocationArgs<Context = UnknownContext, TParameters extends ToolInputParameters = ToolInputParameters, Result = unknown> = {
    tool: FunctionTool<Context, TParameters, Result>;
    runContext: RunContext<Context>;
    input: string;
    details?: ToolCallDetails;
};
/**
 * Invoke a function tool while enforcing optional per-tool timeout settings.
 */
export declare function invokeFunctionTool<Context = UnknownContext, TParameters extends ToolInputParameters = ToolInputParameters, Result = unknown>(args: FunctionToolInvocationArgs<Context, TParameters, Result>): Promise<string | Result>;
/**
 * Exposes a function to the agent as a tool to be called
 *
 * @param options The options for the tool
 * @returns A new tool
 */
export declare function tool<TParameters extends ToolInputParameters = undefined, Context = UnknownContext, Result = string>(options: ToolOptions<TParameters, Context>): FunctionTool<Context, TParameters, Result>;
export type ToolNamespaceOptions<TTools extends readonly AnyFunctionTool[] = readonly AnyFunctionTool[]> = {
    /**
     * The namespace name to expose to the model.
     */
    name: string;
    /**
     * Description shared by all tools in the namespace.
     */
    description: string;
    /**
     * Function tools to attach to the namespace.
     */
    tools: TTools;
};
/**
 * Responses API only. Group function tools under a shared namespace.
 *
 * @param options - Namespace metadata and function tools to attach.
 * @returns shallow-cloned function tools carrying namespace metadata.
 */
export declare function toolNamespace<TTools extends readonly AnyFunctionTool[]>(options: ToolNamespaceOptions<TTools>): TTools;
