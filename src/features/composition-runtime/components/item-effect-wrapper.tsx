import React from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import type { AdjustmentItem } from '@/types/timeline';

/** Adjustment layer with its track order for scope calculation */
export interface AdjustmentLayerWithTrackOrder {
  layer: AdjustmentItem;
  trackOrder: number;
}

interface ItemEffectWrapperProps {
  /** The item's track order (used to determine if effects should apply) */
  itemTrackOrder: number;
  /** All adjustment layers (from visible tracks) */
  adjustmentLayers: AdjustmentLayerWithTrackOrder[];
  /** The `from` value of the nearest parent Sequence (for converting local to global frame) */
  sequenceFrom: number;
  /** Children to render */
  children: React.ReactNode;
}

/** Internal props including frame for memoization */
interface ItemEffectWrapperInternalProps extends ItemEffectWrapperProps {
  frame: number;
}

/**
 * Legacy CSS effect rendering removed — all adjustment layer effects now render
 * via GPU pipeline in client-render-engine (canvas-effects.ts).
 * This wrapper simply passes children through with the same DOM structure.
 */
const ItemEffectWrapperInternal = React.memo<ItemEffectWrapperInternalProps>(({
  children,
}) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
});

/**
 * Frame-aware wrapper for ItemEffectWrapper.
 * Isolates useSequenceContext to this component so that parent components
 * don't re-render on every frame. Only this component and its children
 * will re-render per frame.
 */
export const ItemEffectWrapper: React.FC<ItemEffectWrapperProps> = (props) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  return <ItemEffectWrapperInternal {...props} frame={frame} />;
};
