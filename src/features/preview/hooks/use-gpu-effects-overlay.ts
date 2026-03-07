import { useEffect, useState } from 'react';
import { useItemsStore } from '@/features/preview/deps/timeline-store';

/**
 * Detects whether any timeline items have GPU effects enabled.
 *
 * GPU effects are applied per-item inside the composition renderer
 * (client-render-engine.ts). This hook returns the detection state so
 * that the scrub system can force composition renders on every frame
 * change (not just during scrub gestures).
 *
 * The overlay canvas visibility is gated separately — returning true
 * here does NOT mean the overlay should render effects.
 */
export function useGpuEffectsOverlay(
  _gpuCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  _playerContainerRef: React.RefObject<HTMLDivElement | null>,
  _scrubOffscreenRef: React.RefObject<OffscreenCanvas | null>,
  _scrubFrameDirtyRef: React.RefObject<boolean>,
) {
  const [hasGpuEffects, setHasGpuEffects] = useState(false);

  useEffect(() => {
    const check = () => {
      const items = useItemsStore.getState().items;
      setHasGpuEffects(
        items.some((item) => item.effects?.some((e) => e.enabled && e.effect.type === 'gpu-effect'))
      );
    };
    check();
    return useItemsStore.subscribe(check);
  }, []);

  return hasGpuEffects;
}
