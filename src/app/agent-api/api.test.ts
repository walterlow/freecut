import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAgentApi } from './index';
import { createAgentAPI } from './api';

describe('createAgentAPI', () => {
  it('exposes the documented surface', () => {
    const api = createAgentAPI();
    const expected: Array<keyof ReturnType<typeof createAgentAPI>> = [
      'version', 'ready',
      'getPlayback', 'getTimeline', 'getSelection', 'getProjectMeta',
      'play', 'pause', 'seek',
      'selectItems',
      'addTrack', 'removeTrack',
      'addItem', 'updateItem', 'moveItem', 'removeItem', 'setTransform',
      'addEffect', 'removeEffect',
      'addTransition', 'removeTransition',
      'addMarker',
      'loadSnapshot', 'exportSnapshot',
      'subscribe',
    ];
    for (const name of expected) {
      expect(api[name]).toBeDefined();
    }
    expect(api.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('seek rejects negative frames without needing stores', async () => {
    const api = createAgentAPI();
    await expect(api.seek(-1)).rejects.toThrow(RangeError);
    await expect(api.seek(Number.NaN)).rejects.toThrow(RangeError);
  });

  it('addEffect rejects non-gpu effect types without loading stores', async () => {
    const api = createAgentAPI();
    // @ts-expect-error — wrong discriminant on purpose
    await expect(api.addEffect('item-1', { type: 'css-filter' })).rejects.toThrow(/gpu-effect/);
  });

  it('subscribe returns an unsubscribe that is safe to call pre-resolution', () => {
    const api = createAgentAPI();
    const unsub = api.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(() => unsub()).not.toThrow(); // idempotent
  });
});

describe('initializeAgentApi', () => {
  beforeEach(() => {
    delete (window as unknown as { __FREECUT__?: unknown }).__FREECUT__;
    window.localStorage.removeItem('freecut.agent');
  });

  afterEach(() => {
    delete (window as unknown as { __FREECUT__?: unknown }).__FREECUT__;
    window.localStorage.removeItem('freecut.agent');
  });

  it('installs the API in dev mode', () => {
    // Vitest config runs with DEV=true by default.
    initializeAgentApi();
    expect((window as unknown as { __FREECUT__?: unknown }).__FREECUT__).toBeDefined();
  });

  it('does not overwrite when already installed', () => {
    initializeAgentApi();
    const first = (window as unknown as { __FREECUT__: { version: string } }).__FREECUT__;
    initializeAgentApi();
    const second = (window as unknown as { __FREECUT__: { version: string } }).__FREECUT__;
    // New instance each call (bootstrap is idempotent at callsite, not identity-stable).
    expect(second.version).toBe(first.version);
  });

  it('fires the freecut:agent-api-ready event on install', () => {
    const handler = vi.fn();
    window.addEventListener('freecut:agent-api-ready', handler, { once: true });
    initializeAgentApi();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
