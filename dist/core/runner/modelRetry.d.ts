import type { Model, ModelRequest, ModelResponse, RetryPolicy } from '../model';
import type { StreamEvent } from '../types/protocol';
export declare const retryPolicies: {
    readonly never: () => RetryPolicy;
    readonly providerSuggested: () => RetryPolicy;
    readonly networkError: () => RetryPolicy;
    readonly httpStatus: (statuses: number[]) => RetryPolicy;
    readonly retryAfter: () => RetryPolicy;
    readonly any: (...policies: RetryPolicy[]) => RetryPolicy;
    readonly all: (...policies: RetryPolicy[]) => RetryPolicy;
};
export declare function getResponseWithRetry(model: Model, request: ModelRequest): Promise<ModelResponse>;
export declare function getStreamedResponseWithRetry(model: Model, request: ModelRequest): AsyncIterable<StreamEvent>;
