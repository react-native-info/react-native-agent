import debug from 'debug';
import { logging } from './config';
/**
 * Get a logger for a given package.
 *
 * @param namespace - the namespace to use for the logger.
 * @returns A logger object with `debug` and `error` methods.
 */
export function getLogger(namespace = 'openai-agents') {
    return {
        namespace,
        debug: debug(namespace),
        error: (...args) => console.error(...args),
        warn: (...args) => console.warn(...args),
        get dontLogModelData() {
            return logging.dontLogModelData;
        },
        get dontLogToolData() {
            return logging.dontLogToolData;
        },
    };
}
export const logger = getLogger('openai-agents:core');
export default logger;
//# sourceMappingURL=logger.js.map