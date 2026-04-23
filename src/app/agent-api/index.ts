/**
 * Bootstrap for `window.__FREECUT__`. Called from `main.tsx`.
 *
 * Activation:
 * - always on in dev (import.meta.env.DEV)
 * - in prod, on when the URL has `?agent=1` OR `localStorage['freecut.agent']`
 *   is set. The user explicitly opts in so drive-by pages can't read state.
 */

import { createAgentAPI, type FreecutAgentAPI } from './api';

export type { FreecutAgentAPI } from './api';

function isEnabledInProd(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URL(window.location.href).searchParams;
    if (params.get('agent') === '1') return true;
    return window.localStorage.getItem('freecut.agent') === '1';
  } catch {
    return false;
  }
}

export function initializeAgentApi(): void {
  if (typeof window === 'undefined') return;
  const enabled = import.meta.env.DEV || isEnabledInProd();
  if (!enabled) return;
  const api = createAgentAPI();
  (window as unknown as { __FREECUT__: FreecutAgentAPI }).__FREECUT__ = api;
  window.dispatchEvent(new CustomEvent('freecut:agent-api-ready', { detail: { version: api.version } }));
}

declare global {
  interface Window {
    __FREECUT__?: FreecutAgentAPI;
  }
}
