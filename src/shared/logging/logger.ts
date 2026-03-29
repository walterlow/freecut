/**
 * Structured logging utility with log levels and wide event support
 *
 * IMPORTANT: This module uses only `function` declarations (no `class` or `const`
 * at module scope) so that Rollup/Vite can hoist them in production chunks.
 * `class` and `let`/`const` have temporal dead zones that cause
 * "Cannot access before initialization" when chunk ordering places callers
 * (e.g. connection.ts) before this module's body.
 *
 * Usage:
 *   import { createLogger, createOperationId } from '@/shared/logging/logger';
 *   const log = createLogger('MyComponent');
 *   log.debug('Details here', { data });
 *   log.info('Operation complete');
 *   log.warn('Something unexpected');
 *   log.error('Failed', error);
 *
 * Wide event pattern:
 *   const opId = createOperationId();
 *   const event = log.startEvent('export', opId);
 *   event.set('codec', 'h264');
 *   event.set('tracks', 5);
 *   event.success();   // emits structured event via log.info
 *   // or: event.failure(error);
 */

export type EventData = Record<string, unknown>;

export interface WideEvent {
  /** Add a key-value pair to the event */
  set(key: string, value: unknown): void;
  /** Merge multiple key-value pairs */
  merge(data: EventData): void;
  /** Emit the event as a success */
  success(extra?: EventData): void;
  /** Emit the event as a failure */
  failure(error: unknown, extra?: EventData): void;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Emit a structured wide event (single object, no string message) */
  event(name: string, data: EventData): void;
  /** Start a wide event that accumulates context and emits on completion */
  startEvent(name: string, operationId?: string): WideEvent;
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

function isDev(): boolean {
  return (
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env !== 'undefined' &&
    !!import.meta.env.DEV
  );
}

/**
 * Generate a short operation ID for correlating log events across a single flow.
 */
export function createOperationId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function makeLogger(prefix: string, level: number): Logger {
  let currentLevel = level;

  function emitEvent(name: string, data: EventData): void {
    if (!shouldLog(1, currentLevel)) return;
    // eslint-disable-next-line no-console
    console.info(
      formatMessage(prefix, name),
      data,
    );
  }

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
    event(name: string, data: EventData): void {
      emitEvent(name, data);
    },
    startEvent(name: string, operationId?: string): WideEvent {
      const startTime = Date.now();
      const eventData: EventData = {};
      if (operationId) {
        eventData.opId = operationId;
      }
      if (isDev()) {
        eventData.env = 'development';
      }

      return {
        set(key: string, value: unknown): void {
          eventData[key] = value;
        },
        merge(data: EventData): void {
          Object.assign(eventData, data);
        },
        success(extra?: EventData): void {
          eventData.outcome = 'success';
          eventData.duration_ms = Date.now() - startTime;
          if (extra) Object.assign(eventData, extra);
          emitEvent(name, eventData);
        },
        failure(error: unknown, extra?: EventData): void {
          eventData.outcome = 'error';
          eventData.duration_ms = Date.now() - startTime;
          if (error instanceof Error) {
            eventData.error = { message: error.message, name: error.name };
          } else {
            eventData.error = String(error);
          }
          if (extra) Object.assign(eventData, extra);
          // Failures always go to console.error as well
          if (shouldLog(3, currentLevel)) {
            console.error(formatMessage(prefix, name), eventData);
          } else {
            emitEvent(name, eventData);
          }
        },
      };
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
