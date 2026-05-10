import { RunContext } from '../runContext';
import type { ToolErrorFormatter, ToolErrorFormatterArgs } from '../run';
export declare const TOOL_APPROVAL_REJECTION_MESSAGE = "Tool execution was not approved.";
type ApprovalRejectedToolType = ToolErrorFormatterArgs['toolType'];
type ApprovalRejectionMessageOptions<TContext = unknown> = {
    runContext: RunContext<TContext>;
    toolType: ApprovalRejectedToolType;
    toolName: string;
    callId: string;
    toolErrorFormatter?: ToolErrorFormatter<TContext>;
};
export declare function resolveApprovalRejectionMessage<TContext>({ runContext, toolType, toolName, callId, toolErrorFormatter, }: ApprovalRejectionMessageOptions<TContext>): Promise<string>;
export {};
