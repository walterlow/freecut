import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import type { AnimatableProperty } from '@/types/keyframe'
import type { EffectMoveProps } from './effect-move-buttons'

export type GpuParamValue = number | boolean | string
export type GpuParamUpdates = Record<string, GpuParamValue>

/** Props shared by every GPU effect panel (curves, wheels, lut, generic). */
export interface GpuPanelBaseProps extends EffectMoveProps {
  effect: ItemEffect
  gpuEffect: GpuEffect
  definition: GpuEffectDefinition
  onParamChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
  onParamLiveChange: (effectId: string, paramKey: string, value: GpuParamValue) => void
  onReset: (effectId: string) => void
  onToggle: (effectId: string) => void
  onRemove: (effectId: string) => void
}

/** Base props for panels whose params can be keyframed. */
export interface GpuKeyframePanelProps extends GpuPanelBaseProps {
  itemIds: string[]
  getKeyframeProperty: (effectId: string, paramKey: string) => AnimatableProperty | null
}
