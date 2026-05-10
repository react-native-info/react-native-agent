import { RunToolApprovalItem } from './items';
import { UnknownContext } from './types';
import { Usage } from './usage';
type ApprovalRecord = {
    approved: boolean | string[];
    rejected: boolean | string[];
    messages?: Record<string, string>;
    stickyRejectMessage?: string;
};
type RunContextJson = {
    context: any;
    usage: Usage;
    approvals: Record<string, ApprovalRecord>;
    toolInput?: unknown;
};
/**
 * A context object that is passed to the `Runner.run()` method.
 */
export declare class RunContext<TContext = UnknownContext> {
    #private;
    /**
     * The context object you passed to the `Runner.run()` method.
     */
    context: TContext;
    /**
     * The usage of the agent run so far. For streamed responses, the usage will be updated in real-time
     */
    usage: Usage;
    /**
     * Structured input for the current agent tool run, when available.
     */
    toolInput?: unknown;
    constructor(context?: TContext);
    /**
     * Creates a child context instance for forked runs.
     * Subclasses should override this to preserve custom instance state safely.
     * @internal
     */
    protected _createFork(): RunContext<TContext>;
    /**
     * Copies shared runtime state into a child context.
     * @internal
     */
    protected _cloneSharedState<TTarget extends RunContext<TContext>>(target: TTarget): TTarget;
    /**
     * Rebuild the approvals map from a serialized state.
     * @internal
     *
     * @param approvals - The approvals map to rebuild.
     */
    _rebuildApprovals(approvals: Record<string, ApprovalRecord>): void;
    /**
     * Merge approvals from a serialized state without discarding existing entries.
     * @internal
     *
     * @param approvals - The approvals map to merge.
     */
    _mergeApprovals(approvals: Record<string, ApprovalRecord>): void;
    /**
     * Retrieve the caller-provided rejection message for a specific tool call.
     *
     * @param toolName - The name of the tool.
     * @param callId - The call ID of the tool invocation.
     * @returns The message string if one was provided, `undefined` otherwise.
     */
    getRejectionMessage(toolName: string, callId: string): string | undefined;
    /**
     * Check if a tool call has been approved.
     *
     * @param approval - Details about the tool call being evaluated.
     * @returns `true` if the tool call has been approved, `false` if blocked and `undefined` if not yet approved or rejected.
     */
    isToolApproved(approval: {
        toolName: string;
        callId: string;
    }): boolean | undefined;
    /**
     * Approve a tool call.
     *
     * @param approvalItem - The tool approval item to approve.
     * @param options - Additional approval behavior options.
     */
    approveTool(approvalItem: RunToolApprovalItem, { alwaysApprove }?: {
        alwaysApprove?: boolean;
    }): void;
    /**
     * Reject a tool call.
     *
     * @param approvalItem - The tool approval item to reject.
     */
    rejectTool(approvalItem: RunToolApprovalItem, { alwaysReject, message, }?: {
        alwaysReject?: boolean;
        message?: string;
    }): void;
    /**
     * Creates a child context that shares approvals and usage, with tool input set.
     * @internal
     */
    _forkWithToolInput(toolInput: unknown): RunContext<TContext>;
    /**
     * Creates a child context that shares approvals and usage, without tool input.
     * @internal
     */
    _forkWithoutToolInput(): RunContext<TContext>;
    toJSON(): RunContextJson;
}
export {};
