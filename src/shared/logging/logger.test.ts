import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, getLoggerControls } from './logger';

describe('logger', () => {
  const loggerStorageKey = 'freecut:logger-config';
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  function resetLoggerRuntime(): void {
    delete (globalThis as typeof globalThis & {
      __FREECUT_LOGGER_STATE__?: unknown;
      __FREECUT_LOGGER_CONTROLS__?: unknown;
    }).__FREECUT_LOGGER_STATE__;
    delete (globalThis as typeof globalThis & {
      __FREECUT_LOGGER_STATE__?: unknown;
      __FREECUT_LOGGER_CONTROLS__?: unknown;
    }).__FREECUT_LOGGER_CONTROLS__;
  }

  beforeEach(() => {
    window.localStorage.removeItem(loggerStorageKey);
    resetLoggerRuntime();
    getLoggerControls().reset();
    getLoggerControls().clearHistory();
    debugSpy.mockClear();
    infoSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    getLoggerControls().reset();
    getLoggerControls().clearPersistedConfig();
    resetLoggerRuntime();
  });

  it('defaults to warn so debug and info logs stay out of the console', () => {
    const log = createLogger('ClientRenderEngine');

    log.debug('debug message');
    log.info('info message');
    log.warn('warn message');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[ClientRenderEngine] warn message');
  });

  it('supports module-level overrides for targeted debugging', () => {
    const controls = getLoggerControls();
    controls.setModuleLevel('ClientRenderEngine', 'debug');

    const log = createLogger('ClientRenderEngine');
    const other = createLogger('CanvasAudio');

    log.debug('frame detail', { frame: 12 });
    other.debug('other detail');

    expect(debugSpy).toHaveBeenCalledWith(
      '[ClientRenderEngine] frame detail',
      { frame: 12 },
    );
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps recent emitted logs for later inspection', () => {
    const controls = getLoggerControls();
    controls.setGlobalLevel('info');

    const log = createLogger('Preview');
    log.info('Renderer ready', { clips: 2 });

    expect(controls.getRecentLogs()).toEqual([
      expect.objectContaining({
        level: 'info',
        prefix: 'Preview',
        message: 'Renderer ready',
        details: ['{clips}'],
      }),
    ]);
  });

  it('keeps debug overrides session-only unless explicitly persisted', () => {
    const controls = getLoggerControls();

    controls.setGlobalLevel('debug');
    expect(window.localStorage.getItem(loggerStorageKey)).toBeNull();

    controls.persist();
    expect(window.localStorage.getItem(loggerStorageKey)).toContain('"globalLevel":"debug"');

    controls.clearPersistedConfig();
    expect(window.localStorage.getItem(loggerStorageKey)).toBeNull();
  });

  it('ignores legacy persisted configs that were saved implicitly', () => {
    window.localStorage.setItem(loggerStorageKey, JSON.stringify({
      globalLevel: 'debug',
    }));
    resetLoggerRuntime();

    const log = createLogger('ClientRenderEngine');
    log.info('legacy info');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(loggerStorageKey)).toBeNull();
  });

  it('rate limits repeated warnings as well as debug/info noise', () => {
    const log = createLogger('CanvasPool');

    log.warn('Canvas pool exhausted, creating temporary canvas');
    log.warn('Canvas pool exhausted, creating temporary canvas');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[CanvasPool] Canvas pool exhausted, creating temporary canvas',
    );
  });
});
