/**
 * Structured logging utility with log levels
 *
 * IMPORTANT: This module uses only `function` declarations (no `class` or `const`
 * at module scope) so that Rollup/Vite can hoist them in production chunks.
 * `class` and `let`/`const` have temporal dead zones that cause
 * "Cannot access before initialization" when chunk ordering places callers
 * (e.g. connection.ts) before this module's body.
 *
 * Usage:
 *   import { createLogger } from '@/shared/logging/logger';
 *   const log = createLogger('MyComponent');
 *   log.debug('Details here', { data });
 *   log.info('Operation complete');
 *   log.warn('Something unexpected');
 *   log.error('Failed', error);
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(prefix: string): Logger;
  setLevel(level: number): void;
}

// All functions below are `function` declarations — fully hoisted in JS,
// safe to call before the module body executes in a Rollup chunk.

function getDefaultLevel(): number {
  // 0 = DEBUG, 2 = WARN
  return (
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env !== 'undefined' &&
    import.meta.env.DEV
  )
    ? 0
    : 2;
}

function shouldLog(current: number, threshold: number): boolean {
  return current >= threshold;
}

function formatMessage(prefix: string, message: string): string {
  return prefix ? `[${prefix}] ${message}` : message;
}

function makeLogger(prefix: string, level: number): Logger {
  let currentLevel = level;

  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog(0, currentLevel)) {
        // eslint-disable-next-line no-console
        console.log(formatMessage(prefix, message), ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog(1, currentLevel)) {
        // eslint-disable-next-line no-console
        console.info(formatMessage(prefix, message), ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog(2, currentLevel)) {
        console.warn(formatMessage(prefix, message), ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (shouldLog(3, currentLevel)) {
        console.error(formatMessage(prefix, message), ...args);
      }
    },
    child(childPrefix: string): Logger {
      return makeLogger(
        prefix ? `${prefix}:${childPrefix}` : childPrefix,
        currentLevel,
      );
    },
    setLevel(newLevel: number): void {
      currentLevel = newLevel;
    },
  };
}

/**
 * Factory for creating module-specific loggers
 *
 * @example
 * const log = createLogger('useRender');
 * log.debug('Socket connected');
 */
export function createLogger(module: string): Logger {
  return makeLogger(module, getDefaultLevel());
}
