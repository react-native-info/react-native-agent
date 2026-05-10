import { Agent, AgentOutputType } from '../agent';
import { MaxTurnsExceededError, ModelRefusalError } from '../errors';
import { RunItem, RunMessageOutputItem } from '../items';
import { ModelResponse } from '../model';
import { RunResult, StreamedRunResult } from '../result';
import { RunContext } from '../runContext';
import { RunState } from '../runState';
import type { AgentInputItem, AgentOutputItem, ResolvedAgentOutput } from '../types';
import type { OutputGuardrailDefinition, OutputGuardrailMetadata } from '../guardrail';
/**
 * Error kinds supported by run error handlers.
 */
export type RunErrorKind = 'maxTurns' | 'modelRefusal';
/**
 * Snapshot of run data passed to error handlers.
 */
export type RunErrorData<TContext, TAgent extends Agent<any, any>> = {
    input: string | AgentInputItem[];
    newItems: RunItem[];
    history: AgentInputItem[];
    output: AgentOutputItem[];
    rawResponses: ModelResponse[];
    lastAgent?: TAgent;
    state?: RunState<TContext, TAgent>;
};
export type RunErrorHandlerInput<TContext, TAgent extends Agent<any, any>> = {
    error: MaxTurnsExceededError | ModelRefusalError;
    context: RunContext<TContext>;
    runData: RunErrorData<TContext, TAgent>;
};
export type RunErrorHandlerResult<TAgent extends Agent<any, any>> = {
    /**
     * The final output to return for the run.
     */
    finalOutput: ResolvedAgentOutput<TAgent['outputType']>;
    /**
     * Whether to append the synthesized output to history for subsequent runs.
     */
    includeInHistory?: boolean;
};
export type RunErrorHandler<TContext, TAgent extends Agent<any, any>> = (input: RunErrorHandlerInput<TContext, TAgent>) => RunErrorHandlerResult<TAgent> | void | Promise<RunErrorHandlerResult<TAgent> | void>;
export type RunErrorHandlers<TContext, TAgent extends Agent<any, any>> = Partial<Record<RunErrorKind, RunErrorHandler<TContext, TAgent>>> & {
    /**
     * Fallback handler for supported error kinds.
     */
    default?: RunErrorHandler<TContext, TAgent>;
};
type TryHandleRunErrorArgs<TContext, TAgent extends Agent<any, any>> = {
    error: unknown;
    state: RunState<TContext, TAgent>;
    errorHandlers?: RunErrorHandlers<TContext, TAgent>;
    outputGuardrailDefs: OutputGuardrailDefinition<OutputGuardrailMetadata, AgentOutputType<unknown>>[];
    emitAgentEnd: (context: RunContext<TContext>, agent: TAgent, outputText: string) => void;
    streamResult?: StreamedRunResult<TContext, TAgent>;
};
type ResolveRunErrorHandlerArgs<TContext, TAgent extends Agent<any, any>> = {
    error: unknown;
    errorHandlers?: RunErrorHandlers<TContext, TAgent>;
    context: RunContext<TContext>;
    runData: RunErrorData<TContext, TAgent>;
};
export declare const formatRunErrorFinalOutput: <TAgent extends Agent<any, any>>(agent: TAgent, finalOutput: ResolvedAgentOutput<TAgent["outputType"]>) => string;
export declare const createRunErrorFinalOutputItem: <TAgent extends Agent<any, any>>(agent: TAgent, outputText: string) => RunMessageOutputItem;
export declare const resolveRunErrorHandler: <TContext, TAgent extends Agent<any, any>>({ error, errorHandlers, context, runData, }: ResolveRunErrorHandlerArgs<TContext, TAgent>) => Promise<RunErrorHandlerResult<TAgent> | undefined>;
export declare const tryHandleRunError: <TContext, TAgent extends Agent<TContext, AgentOutputType>>({ error, state, errorHandlers, outputGuardrailDefs, emitAgentEnd, streamResult, }: TryHandleRunErrorArgs<TContext, TAgent>) => Promise<RunResult<TContext, TAgent> | undefined>;
export {};
