import type { Agent } from './agent';
import type { RunResult, StreamedRunResult } from './result';
import type * as protocol from './types/protocol';
type AnyAgentRunResult = RunResult<any, Agent<any, any>> | StreamedRunResult<any, Agent<any, any>>;
export declare function saveAgentToolRunResult(toolCall: protocol.FunctionCallItem | undefined, runResult: AnyAgentRunResult): void;
export declare function consumeAgentToolRunResult(toolCall: protocol.FunctionCallItem): AnyAgentRunResult | undefined;
export {};
