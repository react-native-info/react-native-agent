import { FunctionCallResultItem } from '../types/protocol';
import { Agent, AgentOutputType, ToolsToFinalOutputResult } from '../agent';
import { RunItem, RunToolApprovalItem } from '../items';
import { Logger } from '../logger';
import { ModelResponse } from '../model';
import { FunctionToolResult } from '../tool';
import { RunContext } from '../runContext';
import * as protocol from '../types/protocol';
import { RunState } from '../runState';
import type { AgentInputItem, UnknownContext } from '../types';
import type { Runner, ToolErrorFormatter } from '../run';
import type { ToolRunApplyPatch, ToolRunComputer, ToolRunFunction, ToolRunHandoff, ToolRunShell } from './types';
/**
 * @internal
 * Normalizes tool outputs once so downstream code works with fully structured protocol items.
 * Doing this here keeps API surface stable even when providers add new shapes.
 */
export declare function getToolCallOutputItem(toolCall: protocol.FunctionCallItem, output: string | unknown): FunctionCallResultItem;
/**
 * @internal
 * Runs every function tool call requested by the model and returns their outputs alongside
 * the `RunItem` instances that should be appended to history.
 */
export declare function executeFunctionToolCalls<TContext = UnknownContext>(agent: Agent<TContext, any>, toolRuns: ToolRunFunction<TContext>[], runner: Runner, state: RunState<TContext, Agent<TContext, any>>, toolErrorFormatter?: ToolErrorFormatter): Promise<FunctionToolResult<TContext>[]>;
export declare function executeShellActions(agent: Agent<any, any>, actions: ToolRunShell[], runner: Runner, runContext: RunContext, customLogger?: Logger | undefined, toolErrorFormatter?: ToolErrorFormatter): Promise<RunItem[]>;
export declare function executeApplyPatchOperations(agent: Agent<any, any>, actions: ToolRunApplyPatch[], runner: Runner, runContext: RunContext, customLogger?: Logger | undefined, toolErrorFormatter?: ToolErrorFormatter): Promise<RunItem[]>;
/**
 * @internal
 * Executes any computer-use actions emitted by the model and returns the resulting items so
 * the run history reflects the computer session.
 */
export declare function executeComputerActions(agent: Agent<any, any>, actions: ToolRunComputer[], runner: Runner, runContext: RunContext, customLogger?: Logger | undefined, toolErrorFormatter?: ToolErrorFormatter): Promise<RunItem[]>;
/**
 * @internal
 * Drives handoff calls by invoking the downstream agent and capturing any generated items so
 * the current agent can continue with the new context.
 */
export declare function executeHandoffCalls<TContext, TOutput extends AgentOutputType>(agent: Agent<TContext, TOutput>, originalInput: string | AgentInputItem[], preStepItems: RunItem[], newStepItems: RunItem[], newResponse: ModelResponse, runHandoffs: ToolRunHandoff[], runner: Runner, runContext: RunContext<TContext>): Promise<import('./steps').SingleStepResult>;
/**
 * Collects approval interruptions from tool execution results and any additional
 * RunItems (e.g., shell/apply_patch approval placeholders).
 */
export declare function collectInterruptions<TContext = UnknownContext>(toolResults: FunctionToolResult<TContext>[], additionalItems?: RunItem[]): RunToolApprovalItem[];
/**
 * @internal
 * Determines whether tool executions produced a final agent output, triggered an interruption,
 * or whether the agent loop should continue collecting more responses.
 */
export declare function checkForFinalOutputFromTools<TContext, TOutput extends AgentOutputType>(agent: Agent<TContext, TOutput>, toolResults: FunctionToolResult<TContext>[], state: RunState<TContext, Agent<TContext, TOutput>>, additionalInterruptions?: RunItem[]): Promise<ToolsToFinalOutputResult>;
