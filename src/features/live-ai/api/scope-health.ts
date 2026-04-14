/**
 * Scope local server: health check and hardware info.
 * Scope runs at localhost:8000 by default (configurable via VITE_SCOPE_URL).
 */

export interface ScopeHardwareInfo {
  vram: number;
  spoutAvailable: boolean;
}

export interface ScopePipelineStatus {
  loaded: boolean;
  loading: boolean;
  progress: number;
  pipelineName: string | null;
}

function getScopeBaseUrl(): string {
  return (import.meta.env.VITE_SCOPE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000';
}

/**
 * Scope is considered configured if either:
 * - VITE_SCOPE_URL is explicitly set (remote Scope server), or
 * - No URL is set (defaults to localhost:8000 for local dev)
 * The health check will verify actual reachability.
 */
export function isScopeConfigured(): boolean {
  return true;
}

export async function checkScopeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getScopeBaseUrl()}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getScopeHardwareInfo(): Promise<ScopeHardwareInfo | null> {
  try {
    const res = await fetch(`${getScopeBaseUrl()}/api/v1/hardware/info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      vram: typeof data.vram === 'number' ? data.vram : 0,
      spoutAvailable: data.spout === true,
    };
  } catch {
    return null;
  }
}

export async function getScopePipelineStatus(): Promise<ScopePipelineStatus> {
  try {
    const res = await fetch(`${getScopeBaseUrl()}/api/v1/pipeline/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { loaded: false, loading: false, progress: 0, pipelineName: null };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return {
      loaded: data.loaded === true,
      loading: data.loading === true,
      progress: typeof data.progress === 'number' ? data.progress : 0,
      pipelineName: typeof data.pipeline_name === 'string' ? data.pipeline_name : null,
    };
  } catch {
    return { loaded: false, loading: false, progress: 0, pipelineName: null };
  }
}

export { getScopeBaseUrl };
