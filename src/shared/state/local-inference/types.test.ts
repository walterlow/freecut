import { describe, expect, it } from 'vitest';
import {
  getLocalInferenceSummary,
  isLocalInferenceCancellationError,
  LOCAL_INFERENCE_UNLOADED_MESSAGE,
  type LocalInferenceRuntimeRecord,
} from './types';

function createRuntime(
  overrides: Partial<LocalInferenceRuntimeRecord> = {},
): LocalInferenceRuntimeRecord {
  return {
    id: 'runtime-1',
    feature: 'whisper',
    featureLabel: 'Whisper',
    modelKey: 'whisper-tiny',
    modelLabel: 'Tiny',
    backend: 'webgpu',
    state: 'ready',
    estimatedBytes: 256 * 1024 * 1024,
    activeJobs: 0,
    loadedAt: 1000,
    lastUsedAt: 1000,
    unloadable: true,
    ...overrides,
  };
}

describe('local-inference types', () => {
  it('returns null when there are no runtimes', () => {
    expect(getLocalInferenceSummary({})).toBeNull();
  });

  it('summarizes a single runtime', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime(),
    });

    expect(summary).toEqual({
      totalRuntimes: 1,
      totalEstimatedBytes: 256 * 1024 * 1024,
      activeJobs: 0,
      state: 'ready',
      backendLabel: 'WEBGPU',
      primaryLabel: 'Whisper Tiny',
      unloadableCount: 1,
    });
  });

  it('aggregates multiple runtimes and prioritizes active states', () => {
    const summary = getLocalInferenceSummary({
      'runtime-1': createRuntime({
        state: 'loading',
        activeJobs: 1,
      }),
      'runtime-2': createRuntime({
        id: 'runtime-2',
        modelKey: 'whisper-small',
        modelLabel: 'Small',
        backend: 'wasm',
        state: 'running',
        estimatedBytes: 512 * 1024 * 1024,
        activeJobs: 2,
        unloadable: false,
      }),
      'runtime-3': createRuntime({
        id: 'runtime-3',
        backend: 'unknown',
        state: 'error',
        estimatedBytes: undefined,
      }),
    });

    expect(summary).toEqual({
      totalRuntimes: 3,
      totalEstimatedBytes: 768 * 1024 * 1024,
      activeJobs: 3,
      state: 'running',
      backendLabel: 'Mixed',
      primaryLabel: '3 Local Models',
      unloadableCount: 2,
    });
  });

  it('detects unload cancellations', () => {
    expect(
      isLocalInferenceCancellationError(new Error(LOCAL_INFERENCE_UNLOADED_MESSAGE))
    ).toBe(true);
    expect(isLocalInferenceCancellationError(new Error('Something else'))).toBe(false);
    expect(isLocalInferenceCancellationError('Local inference unloaded')).toBe(false);
  });
});
