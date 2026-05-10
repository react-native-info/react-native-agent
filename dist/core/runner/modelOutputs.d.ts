import { Agent } from '../agent';
import { Handoff } from '../handoff';
import { RunItem } from '../items';
import { ModelResponse } from '../model';
import { RunState } from '../runState';
import type { AgentInputItem } from '../types';
import { Tool } from '../tool';
import type { ProcessedResponse } from './types';
/**
 * Walks a raw model response and classifies each item so the runner can schedule follow-up work.
 * Returns both the serializable RunItems (for history/streaming) and the actionable tool metadata.
 */
export declare function processModelResponse<TContext>(modelResponse: ModelResponse, agent: Agent<any, any>, tools: Tool<TContext>[], handoffs: Handoff<any, any>[], priorItems?: Array<RunItem | AgentInputItem>): ProcessedResponse<TContext>;
export declare function processModelResponseAsync<TContext>(modelResponse: ModelResponse, agent: Agent<any, any>, tools: Tool<TContext>[], handoffs: Handoff<any, any>[], state: RunState<TContext, Agent<any, any>>, priorItems?: Array<RunItem | AgentInputItem>): Promise<ProcessedResponse<TContext>>;
