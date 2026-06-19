import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { EffectsSection } from './effects-section'

const mocks = vi.hoisted(() => {
  const timelineState = {
    addEffect: vi.fn(),
    addEffects: vi.fn(),
    updateEffect: vi.fn(),
    removeEffect: vi.fn(),
    toggleEffect: vi.fn(),
    setItemEffects: vi.fn(),
    applyAutoKeyframeOperations: vi.fn(),
  }
  const gizmoState = {
    setEffectsPreviewNew: vi.fn(),
    clearPreview: vi.fn(),
  }
  const presetsState = {
    presets: [],
    loadPresets: vi.fn(() => Promise.resolve()),
    removePreset: vi.fn(() => Promise.resolve()),
  }
  return { timelineState, gizmoState, presetsState }
})

vi.mock('@/features/effects/deps/timeline-contract', () => ({
  useTimelineStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
}))

vi.mock('@/features/effects/deps/preview-contract', () => ({
  useGizmoStore: (selector: (state: typeof mocks.gizmoState) => unknown) =>
    selector(mocks.gizmoState),
  useThrottledFrame: () => 24,
}))

vi.mock('../hooks/use-keyframes-by-item-id', () => ({
  useKeyframesByItemId: () => new Map(),
}))

vi.mock('../hooks/use-gpu-effect-preview-data', () => ({
  useGpuEffectPreviewData: () => ({
    gpuCategories: [],
    triggerPreviews: vi.fn(),
  }),
}))

vi.mock('../stores/user-presets-store', () => ({
  useUserPresetsStore: (selector: (state: typeof mocks.presetsState) => unknown) =>
    selector(mocks.presetsState),
}))

vi.mock('./panels', () => {
  const Panel = ({
    effect,
    onMove,
    canMoveUp,
    canMoveDown,
  }: {
    effect: ItemEffect
    onMove?: (effectId: string, direction: -1 | 1) => void
    canMoveUp?: boolean
    canMoveDown?: boolean
  }) => (
    <div data-testid={`effect-${effect.id}`}>
      <button type="button" disabled={!canMoveUp} onClick={() => onMove?.(effect.id, -1)}>
        move {effect.id} up
      </button>
      <button type="button" disabled={!canMoveDown} onClick={() => onMove?.(effect.id, 1)}>
        move {effect.id} down
      </button>
    </div>
  )
  return {
    GpuEffectPanel: Panel,
    GpuWheelsPanel: Panel,
    GpuCurvesPanel: Panel,
    GpuLutPanel: Panel,
    GpuPowerWindowPanel: Panel,
    GpuSecondaryQualifierPanel: Panel,
  }
})

function makeEffect(id: string, gpuEffectType: string): ItemEffect {
  return {
    id,
    enabled: true,
    effect: { type: 'gpu-effect', gpuEffectType, params: {} },
  }
}

function makeItem(id: string, effects: ItemEffect[]): TimelineItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: `${id}.mp4`,
    src: `blob:${id}`,
    mediaId: `${id}-media`,
    effects,
  }
}

describe('EffectsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reorders visible effects across selected items while preserving hidden color dock effects', () => {
    const hiddenWheels = makeEffect('wheels-a', 'gpu-color-wheels')
    const blurA = makeEffect('blur-a', 'gpu-gaussian-blur')
    const lutA = makeEffect('lut-a', 'gpu-lut')
    const brightnessA = makeEffect('brightness-a', 'gpu-brightness')
    const blurB = makeEffect('blur-b', 'gpu-gaussian-blur')
    const lutB = makeEffect('lut-b', 'gpu-lut')
    const brightnessB = makeEffect('brightness-b', 'gpu-brightness')

    render(
      <EffectsSection
        hiddenGpuEffectTypes={['gpu-color-wheels']}
        items={[
          makeItem('clip-a', [hiddenWheels, blurA, lutA, brightnessA]),
          makeItem('clip-b', [blurB, lutB, brightnessB]),
        ]}
      />,
    )

    fireEvent.click(screen.getByText('move lut-a up'))

    expect(mocks.timelineState.setItemEffects).toHaveBeenCalledWith([
      { itemId: 'clip-a', effects: [hiddenWheels, lutA, blurA, brightnessA] },
      { itemId: 'clip-b', effects: [lutB, blurB, brightnessB] },
    ])
  })
})
