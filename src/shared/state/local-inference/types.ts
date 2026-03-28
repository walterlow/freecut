export type LocalInferenceBackend = 'webgpu' | 'wasm' | 'unknown';
export type LocalInferenceState = 'loading' | 'running' | 'ready' | 'error';

export interface LocalInferenceRuntimeRecord {
  id: string;
  feature: string;
  featureLabel: string;
  modelKey: string;
  modelLabel: string;
  backend: LocalInferenceBackend;
  state: LocalInferenceState;
  estimatedBytes?: number;
  activeJobs: number;
  loadedAt: number;
  lastUsedAt: number;
  unloadable: boolean;
  errorMessage?: string;
}

export interface LocalInferenceStateShape {
  runtimesById: Record<string, LocalInferenceRuntimeRecord>;
}

export interface LocalInferenceActions {
  registerRuntime: (runtime: LocalInferenceRuntimeRecord) => void;
  updateRuntime: (
    id: string,
    updates: Partial<Omit<LocalInferenceRuntimeRecord, 'id'>>,
  ) => void;
  unregisterRuntime: (id: string) => void;
  clearRuntimes: () => void;
}

export interface LocalInferenceSummary {
  totalRuntimes: number;
  totalEstimatedBytes: number;
  activeJobs: number;
  state: LocalInferenceState;
  backendLabel: string | null;
  primaryLabel: string;
  unloadableCount: number;
}

export const LOCAL_INFERENCE_UNLOADED_MESSAGE = 'Local inference unloaded';

export function isLocalInferenceCancellationError(error: unknown): boolean {
  return error instanceof Error && error.message === LOCAL_INFERENCE_UNLOADED_MESSAGE;
}

export function getLocalInferenceSummary(
  runtimesById: Record<string, LocalInferenceRuntimeRecord>,
): LocalInferenceSummary | null {
  const runtimes = Object.values(runtimesById);
  if (runtimes.length === 0) {
    return null;
  }

  const state: LocalInferenceState = runtimes.some((runtime) => runtime.state === 'running')
    ? 'running'
    : runtimes.some((runtime) => runtime.state === 'loading')
      ? 'loading'
      : runtimes.some((runtime) => runtime.state === 'error')
        ? 'error'
        : 'ready';

  const backendLabels = new Set(
    runtimes
      .map((runtime) => runtime.backend)
      .filter((backend) => backend !== 'unknown')
      .map((backend) => backend.toUpperCase())
  );

  return {
    totalRuntimes: runtimes.length,
    totalEstimatedBytes: runtimes.reduce((total, runtime) => total + (runtime.estimatedBytes ?? 0), 0),
    activeJobs: runtimes.reduce((total, runtime) => total + runtime.activeJobs, 0),
    state,
    backendLabel: backendLabels.size === 1 ? [...backendLabels][0] : backendLabels.size > 1 ? 'Mixed' : null,
    primaryLabel: runtimes.length === 1
      ? `${runtimes[0]?.featureLabel} ${runtimes[0]?.modelLabel ?? ''}`.trim()
      : `${runtimes.length} Local Models`,
    unloadableCount: runtimes.filter((runtime) => runtime.unloadable).length,
  };
}
