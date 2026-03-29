import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localInferenceRuntimeRegistry } from './registry';
import { useLocalInferenceStore } from './store';
import type { LocalInferenceRuntimeRecord } from './types';

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
    state: 'loading',
    estimatedBytes: 128 * 1024 * 1024,
    activeJobs: 1,
    loadedAt: 1000,
    lastUsedAt: 1000,
    unloadable: true,
    ...overrides,
  };
}

function resetRegistry() {
  const registryState = localInferenceRuntimeRegistry as unknown as {
    controllers: Map<string, { unload: () => Promise<void> | void }>;
  };
  registryState.controllers.clear();
  useLocalInferenceStore.getState().clearRuntimes();
}

describe('localInferenceRuntimeRegistry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('registers and updates runtimes in the store', () => {
    localInferenceRuntimeRegistry.registerRuntime(createRuntime());
    localInferenceRuntimeRegistry.updateRuntime('runtime-1', {
      state: 'running',
      activeJobs: 2,
    });

    expect(useLocalInferenceStore.getState().runtimesById['runtime-1']).toMatchObject({
      state: 'running',
      activeJobs: 2,
    });
  });

  it('unloads all registered runtimes and clears the store', async () => {
    const unloadFirst = vi.fn();
    const unloadSecond = vi.fn().mockResolvedValue(undefined);

    localInferenceRuntimeRegistry.registerRuntime(
      createRuntime(),
      { unload: unloadFirst }
    );
    localInferenceRuntimeRegistry.registerRuntime(
      createRuntime({
        id: 'runtime-2',
        modelKey: 'whisper-small',
        modelLabel: 'Small',
      }),
      { unload: unloadSecond }
    );

    await expect(localInferenceRuntimeRegistry.unloadAll()).resolves.toBe(2);

    expect(unloadFirst).toHaveBeenCalledTimes(1);
    expect(unloadSecond).toHaveBeenCalledTimes(1);
    expect(useLocalInferenceStore.getState().runtimesById).toEqual({});
  });

  it('drops runtimes without controllers during unload', async () => {
    localInferenceRuntimeRegistry.registerRuntime(createRuntime());

    await expect(localInferenceRuntimeRegistry.unloadRuntime('runtime-1')).resolves.toBe(false);
    expect(useLocalInferenceStore.getState().runtimesById).toEqual({});
  });
});
