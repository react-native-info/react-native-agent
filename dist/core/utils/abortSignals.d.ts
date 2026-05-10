type CombineAbortSignalsResult = {
    signal?: AbortSignal;
    cleanup: () => void;
};
type CombineAbortSignalsOptions = {
    onAbortSignalAnyError?: (error: unknown) => void;
};
export declare function combineAbortSignals(...signals: (AbortSignal | undefined)[]): CombineAbortSignalsResult;
export declare function combineAbortSignalsWithOptions(signals: (AbortSignal | undefined)[], options?: CombineAbortSignalsOptions): CombineAbortSignalsResult;
export {};
