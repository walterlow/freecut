import { useLocalInferenceStore } from './store';
import type { LocalInferenceRuntimeRecord } from './types';

interface LocalInferenceRuntimeController {
  unload: () => Promise<void> | void;
}

class LocalInferenceRuntimeRegistry {
  private readonly controllers = new Map<string, LocalInferenceRuntimeController>();

  registerRuntime(
    runtime: LocalInferenceRuntimeRecord,
    controller?: LocalInferenceRuntimeController,
  ): void {
    if (controller) {
      this.controllers.set(runtime.id, controller);
    }

    useLocalInferenceStore.getState().registerRuntime(runtime);
  }

  updateRuntime(
    id: string,
    updates: Partial<Omit<LocalInferenceRuntimeRecord, 'id'>>,
  ): void {
    useLocalInferenceStore.getState().updateRuntime(id, updates);
  }

  unregisterRuntime(id: string): void {
    this.controllers.delete(id);
    useLocalInferenceStore.getState().unregisterRuntime(id);
  }

  async unloadRuntime(id: string): Promise<boolean> {
    const controller = this.controllers.get(id);
    if (!controller) {
      this.unregisterRuntime(id);
      return false;
    }

    this.controllers.delete(id);
    await controller.unload();
    return true;
  }

  async unloadAll(): Promise<number> {
    const runtimeIds = Object.keys(useLocalInferenceStore.getState().runtimesById);
    await Promise.allSettled(runtimeIds.map((runtimeId) => this.unloadRuntime(runtimeId)));
    useLocalInferenceStore.getState().clearRuntimes();
    return runtimeIds.length;
  }
}

export const localInferenceRuntimeRegistry = new LocalInferenceRuntimeRegistry();
