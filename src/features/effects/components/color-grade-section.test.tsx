import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { useGradeClipboardStore } from '@/shared/state/grade-clipboard'
import { ColorGradeSection } from './color-grade-section'

type ColorGradeComparisonMode = 'off' | 'before' | 'split'

const mocks = vi.hoisted(() => {
  const timelineState = {
    addEffects: vi.fn(),
    setItemEffects: vi.fn(),
    updateEffect: vi.fn(),
    removeEffect: vi.fn(),
    toggleEffect: vi.fn(),
    applyAutoKeyframeOperations: vi.fn(),
  }
  const gizmoState = {
    setEffectsPreviewNew: vi.fn(),
    clearPreview: vi.fn(),
    colorGradeComparisonMode: 'off' as ColorGradeComparisonMode,
    setColorGradeComparisonMode: vi.fn(),
  }
  const presetsState = {
    presets: [],
    loadPresets: vi.fn(() => Promise.resolve()),
    addPreset: vi.fn(() => Promise.resolve(null)),
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
  useThrottledFrame: () => 12,
}))

vi.mock('../hooks/use-keyframes-by-item-id', () => ({
  useKeyframesByItemId: () => new Map(),
}))

vi.mock('../stores/user-presets-store', () => {
  const useUserPresetsStore = (selector: (state: typeof mocks.presetsState) => unknown) =>
    selector(mocks.presetsState)
  useUserPresetsStore.getState = () => mocks.presetsState
  return { useUserPresetsStore }
})

vi.mock('./panels', () => ({
  GpuWheelsPanel: ({
    effect,
    onParamsBatchChange,
    onParamsBatchLiveChange,
  }: {
    effect: ItemEffect
    onParamsBatchChange: (effectId: string, updates: Record<string, number>) => void
    onParamsBatchLiveChange: (effectId: string, updates: Record<string, number>) => void
  }) => (
    <div data-testid="wheels-panel" data-effect-id={effect.id}>
      <button type="button" onClick={() => onParamsBatchLiveChange(effect.id, { lift: 0.1 })}>
        live wheels
      </button>
      <button type="button" onClick={() => onParamsBatchChange(effect.id, { lift: 0.1 })}>
        commit wheels
      </button>
    </div>
  ),
  GpuCurvesPanel: ({
    effect,
    onParamsBatchChange,
  }: {
    effect: ItemEffect
    onParamsBatchChange: (effectId: string, updates: Record<string, string>) => void
  }) => (
    <div data-testid="curves-panel" data-effect-id={effect.id}>
      <button
        type="button"
        onClick={() => onParamsBatchChange(effect.id, { masterPoints: '[[0,0],[1,1]]' })}
      >
        commit curves
      </button>
    </div>
  ),
}))

function makeVideoItem(effects: ItemEffect[] = [], id = 'clip-1'): TimelineItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: 'clip.mp4',
    src: 'blob:clip',
    mediaId: 'media-1',
    effects,
  }
}

describe('ColorGradeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGradeClipboardStore.getState().setGrade([])
    mocks.gizmoState.colorGradeComparisonMode = 'off'
  })

  it('keeps copy and paste grade actions visible in the color panel', () => {
    render(<ColorGradeSection items={[makeVideoItem()]} />)

    expect(screen.getByRole('button', { name: 'Copy grade' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Paste grade' })).toBeDisabled()
  })

  it('disables split comparison until an enabled color grade exists', () => {
    render(<ColorGradeSection items={[makeVideoItem()]} />)

    const splitButton = screen.getByRole('button', {
      name: 'Add or enable a color grade to use split comparison',
    })
    expect(splitButton).toBeDisabled()
    fireEvent.click(splitButton)
    expect(mocks.gizmoState.setColorGradeComparisonMode).not.toHaveBeenCalled()
  })

  it('enables split comparison for clips with an active color grade', () => {
    const gradeEffect: ItemEffect = {
      id: 'grade-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-color-wheels',
        params: { lift: 0.2 },
      },
    }

    render(<ColorGradeSection items={[makeVideoItem([gradeEffect])]} />)

    const splitButton = screen.getByRole('button', {
      name: 'Show ungraded before on the left and graded after on the right',
    })
    expect(splitButton).toBeEnabled()
    fireEvent.click(splitButton)
    expect(mocks.gizmoState.setColorGradeComparisonMode).toHaveBeenCalledWith('split')
  })

  it('falls back to after when split comparison has no active grade to compare', () => {
    mocks.gizmoState.colorGradeComparisonMode = 'split'

    render(<ColorGradeSection items={[makeVideoItem()]} />)

    expect(mocks.gizmoState.setColorGradeComparisonMode).toHaveBeenCalledWith('off')
  })

  it('keeps split disabled for disabled color grades', () => {
    const disabledGradeEffect: ItemEffect = {
      id: 'grade-1',
      enabled: false,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-color-wheels',
        params: { lift: 0.2 },
      },
    }

    render(<ColorGradeSection items={[makeVideoItem([disabledGradeEffect])]} />)

    expect(
      screen.getByRole('button', {
        name: 'Add or enable a color grade to use split comparison',
      }),
    ).toBeDisabled()
  })

  it('previews and creates a single color wheels effect on first adjustment', () => {
    render(<ColorGradeSection items={[makeVideoItem()]} />)

    fireEvent.click(screen.getByText('live wheels'))
    expect(mocks.gizmoState.setEffectsPreviewNew).toHaveBeenCalledWith({
      'clip-1': [
        expect.objectContaining({
          id: '__grade:gpu-color-wheels__',
          effect: expect.objectContaining({
            gpuEffectType: 'gpu-color-wheels',
            params: expect.objectContaining({ lift: 0.1 }),
          }),
        }),
      ],
    })
    expect(mocks.timelineState.addEffects).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('commit wheels'))
    expect(mocks.timelineState.addEffects).toHaveBeenCalledTimes(1)
    expect(mocks.timelineState.addEffects).toHaveBeenCalledWith([
      {
        itemId: 'clip-1',
        effects: [
          expect.objectContaining({
            gpuEffectType: 'gpu-color-wheels',
            params: expect.objectContaining({ lift: 0.1 }),
          }),
        ],
      },
    ])
  })

  it('updates an existing curves effect instead of adding a duplicate', () => {
    const curves: ItemEffect = {
      id: 'curves-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-curves',
        params: { masterPoints: '[[0,0],[1,1]]' },
      },
    }
    render(<ColorGradeSection items={[makeVideoItem([curves])]} />)

    expect(screen.getByTestId('curves-panel')).toHaveAttribute('data-effect-id', 'curves-1')
    fireEvent.click(screen.getByText('commit curves'))

    expect(mocks.timelineState.updateEffect).toHaveBeenCalledWith('clip-1', 'curves-1', {
      effect: {
        ...curves.effect,
        params: { masterPoints: '[[0,0],[1,1]]' },
      },
    })
    expect(mocks.timelineState.addEffects).not.toHaveBeenCalled()
  })

  it('copies the selected color grade and pastes it while preserving non-grade effects', () => {
    const gradeEffect: ItemEffect = {
      id: 'grade-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-color-wheels',
        params: { lift: 0.2 },
      },
    }
    const targetGradeEffect: ItemEffect = {
      id: 'target-grade-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-curves',
        params: { masterPoints: '[[0,0],[1,1]]' },
      },
    }
    const targetBlurEffect: ItemEffect = {
      id: 'target-blur-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-blur',
        params: { radius: 4 },
      },
    }

    render(
      <ColorGradeSection
        items={[
          makeVideoItem([gradeEffect], 'clip-source'),
          makeVideoItem([targetGradeEffect, targetBlurEffect], 'clip-target'),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy grade' }))
    expect(useGradeClipboardStore.getState().grade).toEqual([
      {
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-color-wheels',
          params: { lift: 0.2 },
        },
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Paste grade' }))
    expect(mocks.timelineState.setItemEffects).toHaveBeenCalledWith([
      {
        itemId: 'clip-source',
        effects: [
          expect.objectContaining({
            effect: expect.objectContaining({
              gpuEffectType: 'gpu-color-wheels',
              params: { lift: 0.2 },
            }),
          }),
        ],
      },
      {
        itemId: 'clip-target',
        effects: [
          expect.objectContaining({
            effect: expect.objectContaining({
              gpuEffectType: 'gpu-color-wheels',
              params: { lift: 0.2 },
            }),
          }),
          targetBlurEffect,
        ],
      },
    ])
  })
})
