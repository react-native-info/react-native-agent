export function combineAbortSignals(...signals) {
    return combineAbortSignalsWithOptions(signals);
}
export function combineAbortSignalsWithOptions(signals, options) {
    const activeSignals = signals.filter(Boolean);
    if (activeSignals.length === 0) {
        return {
            cleanup: () => { },
        };
    }
    const anyFn = AbortSignal.any;
    if (typeof anyFn === 'function') {
        try {
            return {
                signal: anyFn(activeSignals),
                cleanup: () => { },
            };
        }
        catch (error) {
            options?.onAbortSignalAnyError?.(error);
            // Fall back to manual signal composition for runtimes without AbortSignal.any support.
        }
    }
    const controller = new AbortController();
    const listeners = [];
    const abortCombined = (reason) => {
        if (!controller.signal.aborted) {
            controller.abort(reason);
        }
    };
    for (const signal of activeSignals) {
        if (signal.aborted) {
            abortCombined(signal.reason);
            break;
        }
        const handler = () => abortCombined(signal.reason);
        signal.addEventListener('abort', handler, { once: true });
        listeners.push({ signal, handler });
    }
    return {
        signal: controller.signal,
        cleanup: () => {
            for (const listener of listeners) {
                listener.signal.removeEventListener('abort', listener.handler);
            }
        },
    };
}
//# sourceMappingURL=abortSignals.js.map