/**
 * Structured logging utility with log levels
 *
 * Usage:
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('MyComponent');
 *   log.debug('Details here', { data });
 *   log.info('Operation complete');
 *   log.warn('Something unexpected');
 *   log.error('Failed', error);
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

interface LoggerConfig {
  level: LogLevel;
  prefix: string;
}

class Logger {
  private config: LoggerConfig;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      // In development, show all logs. In production, only warnings and errors.
      // Safe check for import.meta.env to support both Vite and webpack (Composition SSR) bundlers
      level: (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' && import.meta.env.DEV)
        ? LogLevel.DEBUG
        : LogLevel.WARN,
      prefix: '',
      ...config,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private formatMessage(message: string): string {
    return this.config.prefix ? `[${this.config.prefix}] ${message}` : message;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage(message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(message), ...args);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    });
  }

  /**
   * Set the log level at runtime
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }
}

// Root logger instance
const logger = new Logger();

/**
 * Factory for creating module-specific loggers
 *
 * @example
 * const log = createLogger('useRender');
 * log.debug('Socket connected');
 */
export function createLogger(module: string): Logger {
  return logger.child(module);
}
