/**
 * Structured logging utility with runtime controls.
 *
 * Important: keep runtime declarations as hoistable `function` declarations.
 * This module is imported early by many chunks, so avoiding module-scope TDZ
 * state keeps production chunk ordering safe.
 */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogLevelValue = 0 | 1 | 2 | 3 | 4;

export interface LogRecord {
  timestamp: string;
  ts: number;
  level: LogLevelName;
  prefix: string;
  message: string;
  details: string[];
}

export interface LoggerControls {
  getConfig(): {
    globalLevel: LogLevelName;
    moduleLevels: Record<string, LogLevelName>;
    historyLimit: number;
    rateLimitWindowMs: number;
  };
  getRecentLogs(): LogRecord[];
  clearHistory(): void;
  setGlobalLevel(level: LogLevelName | LogLevelValue): void;
  setModuleLevel(modulePattern: string, level: LogLevelName | LogLevelValue): void;
  clearModuleLevel(modulePattern: string): void;
  persist(): void;
  clearPersistedConfig(): void;
  reset(): void;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(prefix: string): Logger;
  setLevel(level: LogLevelName | LogLevelValue): void;
}

interface LoggerRuntimeState {
  initialized: boolean;
  globalLevel: LogLevelValue;
  moduleLevels: Record<string, LogLevelValue>;
  history: LogRecord[];
  historyLimit: number;
  rateLimitWindowMs: number;
  rateLimit: Record<string, { lastEmitTs: number; suppressedCount: number }>;
}

function getLoggerState(): LoggerRuntimeState {
  const globalObject = globalThis as typeof globalThis & {
    __FREECUT_LOGGER_STATE__?: LoggerRuntimeState;
  };

  if (!globalObject.__FREECUT_LOGGER_STATE__) {
    globalObject.__FREECUT_LOGGER_STATE__ = {
      initialized: false,
      globalLevel: getDefaultLevel(),
      moduleLevels: {},
      history: [],
      historyLimit: 200,
      rateLimitWindowMs: 1000,
      rateLimit: {},
    };
  }

  const state = globalObject.__FREECUT_LOGGER_STATE__;
  if (!state.initialized) {
    initializeLoggerState(state);
  }

  return state;
}

function initializeLoggerState(state: LoggerRuntimeState): void {
  state.initialized = true;
  applyPersistedConfig(state);
  applyQueryParamOverrides(state);
}

function getDefaultLevel(): LogLevelValue {
  // Keep dev consoles quiet by default. Module-level overrides are available
  // via window.__DEBUG__.logger or URL/localStorage-based logger controls.
  return 2;
}

function getLoggerStorageKey(): string {
  return 'freecut:logger-config';
}

function getLoggerLevelParamKey(): string {
  return 'logLevel';
}

function getLoggerModulesParamKey(): string {
  return 'logModules';
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearPersistedLoggerConfig(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    storage.removeItem(getLoggerStorageKey());
  } catch {
    // Ignore storage failures (quota/private mode/disabled storage).
  }
}

function applyPersistedConfig(state: LoggerRuntimeState): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(getLoggerStorageKey());
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      persisted?: boolean;
      globalLevel?: LogLevelName | LogLevelValue;
      moduleLevels?: Record<string, LogLevelName | LogLevelValue>;
      historyLimit?: number;
      rateLimitWindowMs?: number;
    };

    if (parsed.persisted !== true) {
      clearPersistedLoggerConfig();
      return;
    }

    if (parsed.globalLevel !== undefined) {
      state.globalLevel = normalizeLevel(parsed.globalLevel);
    }

    if (parsed.moduleLevels) {
      const nextModuleLevels: Record<string, LogLevelValue> = {};
      for (const [pattern, level] of Object.entries(parsed.moduleLevels)) {
        if (!pattern) continue;
        nextModuleLevels[pattern] = normalizeLevel(level);
      }
      state.moduleLevels = nextModuleLevels;
    }

    if (typeof parsed.historyLimit === 'number' && parsed.historyLimit > 0) {
      state.historyLimit = Math.min(Math.max(Math.round(parsed.historyLimit), 10), 1000);
    }

    if (typeof parsed.rateLimitWindowMs === 'number' && parsed.rateLimitWindowMs >= 0) {
      state.rateLimitWindowMs = Math.min(Math.max(Math.round(parsed.rateLimitWindowMs), 0), 60_000);
    }
  } catch {
    // Ignore malformed config and continue with defaults.
  }
}

function applyQueryParamOverrides(state: LoggerRuntimeState): void {
  if (typeof window === 'undefined' || !window.location?.search) return;

  try {
    const params = new URLSearchParams(window.location.search);
    const levelParam = params.get(getLoggerLevelParamKey());
    if (levelParam) {
      state.globalLevel = normalizeLevel(levelParam);
    }

    const modulesParam = params.get(getLoggerModulesParamKey());
    if (modulesParam) {
      const patterns = modulesParam
        .split(',')
        .map((pattern) => pattern.trim())
        .filter(Boolean);

      for (const pattern of patterns) {
        state.moduleLevels[pattern] = levelParam
          ? normalizeLevel(levelParam)
          : 0;
      }
    }
  } catch {
    // Ignore malformed query overrides.
  }
}

function persistLoggerConfig(state: LoggerRuntimeState): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    const moduleLevels: Record<string, LogLevelName> = {};
    for (const [pattern, level] of Object.entries(state.moduleLevels)) {
      moduleLevels[pattern] = levelToName(level);
    }

    storage.setItem(getLoggerStorageKey(), JSON.stringify({
      persisted: true,
      globalLevel: levelToName(state.globalLevel),
      moduleLevels,
      historyLimit: state.historyLimit,
      rateLimitWindowMs: state.rateLimitWindowMs,
    }));
  } catch {
    // Ignore storage failures (quota/private mode/disabled storage).
  }
}

function normalizeLevel(level: LogLevelName | LogLevelValue | string | number): LogLevelValue {
  if (typeof level === 'number') {
    if (level <= 0) return 0;
    if (level === 1) return 1;
    if (level === 2) return 2;
    if (level === 3) return 3;
    return 4;
  }

  switch (String(level).toLowerCase()) {
    case 'debug': return 0;
    case 'info': return 1;
    case 'warn':
    case 'warning': return 2;
    case 'error': return 3;
    case 'silent':
    case 'off':
    case 'none': return 4;
    default: return getDefaultLevel();
  }
}

function levelToName(level: LogLevelValue): LogLevelName {
  switch (level) {
    case 0: return 'debug';
    case 1: return 'info';
    case 2: return 'warn';
    case 3: return 'error';
    default: return 'silent';
  }
}

function shouldLog(messageLevel: LogLevelValue, threshold: LogLevelValue): boolean {
  return messageLevel >= threshold;
}

function formatMessage(prefix: string, message: string): string {
  return prefix ? `[${prefix}] ${message}` : message;
}

function resolveLevel(prefix: string): LogLevelValue {
  const state = getLoggerState();
  let matchedLevel = state.globalLevel;
  let matchedPatternLength = -1;

  for (const [pattern, level] of Object.entries(state.moduleLevels)) {
    if (!matchesModulePattern(prefix, pattern)) continue;
    if (pattern.length < matchedPatternLength) continue;
    matchedPatternLength = pattern.length;
    matchedLevel = level;
  }

  return matchedLevel;
}

function matchesModulePattern(prefix: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}(?::.*)?$`);
  return regex.test(prefix);
}

function shouldRateLimit(level: LogLevelValue): boolean {
  return level <= 2;
}

function getRateLimitDecision(
  level: LogLevelValue,
  prefix: string,
  message: string,
): { shouldEmit: boolean; summarySuffix: string } {
  if (!shouldRateLimit(level)) {
    return { shouldEmit: true, summarySuffix: '' };
  }

  const state = getLoggerState();
  const now = Date.now();
  const key = `${level}|${prefix}|${message}`;
  const current = state.rateLimit[key];

  if (!current) {
    state.rateLimit[key] = { lastEmitTs: now, suppressedCount: 0 };
    return { shouldEmit: true, summarySuffix: '' };
  }

  if (now - current.lastEmitTs < state.rateLimitWindowMs) {
    current.suppressedCount += 1;
    return { shouldEmit: false, summarySuffix: '' };
  }

  const summarySuffix = current.suppressedCount > 0
    ? ` (suppressed ${current.suppressedCount} similar log${current.suppressedCount === 1 ? '' : 's'})`
    : '';

  current.lastEmitTs = now;
  current.suppressedCount = 0;
  return { shouldEmit: true, summarySuffix };
}

function appendHistory(
  level: LogLevelValue,
  prefix: string,
  message: string,
  args: unknown[],
): void {
  const state = getLoggerState();
  state.history.push({
    timestamp: new Date().toISOString(),
    ts: Date.now(),
    level: levelToName(level),
    prefix,
    message,
    details: args.map((arg) => previewArg(arg)),
  });

  if (state.history.length > state.historyLimit) {
    state.history.splice(0, state.history.length - state.historyLimit);
  }
}

function previewArg(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[Array(${value.length})]`;
  }

  if (typeof value === 'object') {
    try {
      const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
      return `{${keys.join(', ')}}`;
    } catch {
      return '[Object]';
    }
  }

  return typeof value;
}

function emitToConsole(level: LogLevelValue, prefix: string, message: string, args: unknown[]): void {
  const formatted = formatMessage(prefix, message);
  switch (level) {
    case 0:
      // eslint-disable-next-line no-console
      console.debug(formatted, ...args);
      return;
    case 1:
      // eslint-disable-next-line no-console
      console.info(formatted, ...args);
      return;
    case 2:
      console.warn(formatted, ...args);
      return;
    default:
      console.error(formatted, ...args);
  }
}

function writeLog(
  level: LogLevelValue,
  prefix: string,
  localLevel: LogLevelValue | null,
  message: string,
  args: unknown[],
): void {
  const effectiveLevel = localLevel ?? resolveLevel(prefix);
  if (!shouldLog(level, effectiveLevel)) {
    return;
  }

  const rateLimit = getRateLimitDecision(level, prefix, message);
  if (!rateLimit.shouldEmit) {
    return;
  }

  const finalMessage = `${message}${rateLimit.summarySuffix}`;
  appendHistory(level, prefix, finalMessage, args);
  emitToConsole(level, prefix, finalMessage, args);
}

function createLoggerControlsObject(): LoggerControls {
  return {
    getConfig() {
      const state = getLoggerState();
      const moduleLevels: Record<string, LogLevelName> = {};
      for (const [pattern, level] of Object.entries(state.moduleLevels)) {
        moduleLevels[pattern] = levelToName(level);
      }

      return {
        globalLevel: levelToName(state.globalLevel),
        moduleLevels,
        historyLimit: state.historyLimit,
        rateLimitWindowMs: state.rateLimitWindowMs,
      };
    },
    getRecentLogs() {
      return [...getLoggerState().history];
    },
    clearHistory() {
      getLoggerState().history = [];
    },
    setGlobalLevel(level) {
      const state = getLoggerState();
      state.globalLevel = normalizeLevel(level);
      state.rateLimit = {};
    },
    setModuleLevel(modulePattern, level) {
      const state = getLoggerState();
      if (!modulePattern.trim()) return;
      state.moduleLevels[modulePattern.trim()] = normalizeLevel(level);
      state.rateLimit = {};
    },
    clearModuleLevel(modulePattern) {
      const state = getLoggerState();
      delete state.moduleLevels[modulePattern.trim()];
      state.rateLimit = {};
    },
    persist() {
      persistLoggerConfig(getLoggerState());
    },
    clearPersistedConfig() {
      clearPersistedLoggerConfig();
    },
    reset() {
      const state = getLoggerState();
      state.globalLevel = getDefaultLevel();
      state.moduleLevels = {};
      state.history = [];
      state.rateLimit = {};
    },
  };
}

export function getLoggerControls(): LoggerControls {
  const globalObject = globalThis as typeof globalThis & {
    __FREECUT_LOGGER_CONTROLS__?: LoggerControls;
  };

  if (!globalObject.__FREECUT_LOGGER_CONTROLS__) {
    globalObject.__FREECUT_LOGGER_CONTROLS__ = createLoggerControlsObject();
  }

  return globalObject.__FREECUT_LOGGER_CONTROLS__;
}

export function createLogger(module: string): Logger {
  let localLevel: LogLevelValue | null = null;

  return {
    debug(message: string, ...args: unknown[]): void {
      writeLog(0, module, localLevel, message, args);
    },
    info(message: string, ...args: unknown[]): void {
      writeLog(1, module, localLevel, message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      writeLog(2, module, localLevel, message, args);
    },
    error(message: string, ...args: unknown[]): void {
      writeLog(3, module, localLevel, message, args);
    },
    child(childPrefix: string): Logger {
      const child = createLogger(module ? `${module}:${childPrefix}` : childPrefix);
      if (localLevel !== null) {
        child.setLevel(localLevel);
      }
      return child;
    },
    setLevel(level: LogLevelName | LogLevelValue): void {
      localLevel = normalizeLevel(level);
    },
  };
}
