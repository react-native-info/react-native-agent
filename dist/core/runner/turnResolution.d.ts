import { Agent } from '../agent';
import { RunItem } from '../items';
import { ModelResponse } from '../model';
import type { Runner, ToolErrorFormatter } from '../run';
import { RunState } from '../runState';
import { NextStep, SingleStepResult, nextStepSchema } from './steps';
import type { ProcessedResponse } from './types';
import { AgentInputItem } from '../types';
import type { RunErrorHandlers } from './errorHandlers';
/**
 * @internal
 * Continues a turn that was previously interrupted waiting for tool approval. Executes the now
 * approved tools and returns the resulting step transition.
 */
export declare function resolveInterruptedTurn<TContext>(agent: Agent<TContext, any>, originalInput: string | AgentInputItem[], originalPreStepItems: RunItem[], newResponse: ModelResponse, processedResponse: ProcessedResponse, runner: Runner, state: RunState<TContext, Agent<TContext, any>>, toolErrorFormatter?: ToolErrorFormatter): Promise<SingleStepResult>;
/**
 * @internal
 * Executes every follow-up action the model requested (function tools, computer actions, MCP flows),
 * appends their outputs to the run history, and determines the next step for the agent loop.
 */
export declare function resolveTurnAfterModelResponse<TContext, TAgent extends Agent<TContext, any>>(agent: TAgent, originalInput: string | AgentInputItem[], originalPreStepItems: RunItem[], newResponse: ModelResponse, processedResponse: ProcessedResponse<TContext>, runner: Runner, state: RunState<TContext, TAgent>, toolErrorFormatter?: ToolErrorFormatter, errorHandlers?: RunErrorHandlers<TContext, TAgent>): Promise<SingleStepResult>;
export { nextStepSchema };
export type { NextStep };
