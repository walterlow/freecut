import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const timelineState = vi.hoisted(() => ({
  updateItem: vi.fn(),
}))

const previewState = vi.hoisted(() => ({
  setPropertiesPreviewNew: vi.fn(),
  clearPreview: vi.fn(),
  clearPreviewForItems: vi.fn(),
}))

function createStoreHook<TState extends object>(state: TState) {
  const hook = ((selector?: (value: TState) => unknown) =>
    selector ? selector(state) : state) as ((selector?: (value: TState) => unknown) => unknown) & {
    getState: () => TState
  }
  hook.getState = () => state
  return hook
}

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  RotateCcw: () => <span data-testid="rotate-ccw" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode; value: string }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="checkbox" {...props} />
  ),
}))

vi.mock('../components', () => ({
  NumberInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/shared/ui/property-controls/rotary-knob', () => ({
  RotaryKnob: ({ onChange }: { onChange?: (value: number) => void }) => (
    <button type="button" onClick={() => onChange?.(0)}>
      knob
    </button>
  ),
}))

vi.mock('@/features/editor/deps/timeline-store', () => ({
  useTimelineStore: createStoreHook(timelineState),
}))

vi.mock('@/features/editor/deps/preview', () => ({
  useGizmoStore: createStoreHook(previewState),
}))

vi.mock('./audio-eq-curve-editor', () => ({
  AudioEqCurveEditor: ({
    onLiveChange,
    onChange,
  }: {
    onLiveChange: (patch: Record<string, unknown>) => void
    onChange: (patch: Record<string, unknown>) => void
  }) => (
    <div>
      <button type="button" onClick={() => onLiveChange({ audioEqLowGainDb: 5 })}>
        live-eq
      </button>
      <button type="button" onClick={() => onChange({ audioEqLowGainDb: 6 })}>
        commit-eq
      </button>
    </div>
  ),
}))

import { AudioEqPanelContent } from './audio-eq-panel-content'

describe('AudioEqPanelContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancels compact live previews and clears item-scoped preview state on unmount', () => {
    vi.useFakeTimers()

    try {
      const { unmount } = render(
        <AudioEqPanelContent
          targetLabel="Clip"
          layoutMode="compact"
          items={[
            {
              id: 'item-1',
              type: 'audio',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 60,
              label: 'Audio',
              src: 'blob:audio',
              audioEqEnabled: true,
            },
          ]}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'live-eq' }))
      expect(previewState.setPropertiesPreviewNew).not.toHaveBeenCalled()

      unmount()

      act(() => {
        vi.advanceTimersByTime(100)
      })

      expect(previewState.setPropertiesPreviewNew).not.toHaveBeenCalled()
      expect(previewState.clearPreviewForItems).toHaveBeenCalledWith(['item-1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears clip EQ previews per item after a committed change', async () => {
    render(
      <AudioEqPanelContent
        targetLabel="Clip"
        items={[
          {
            id: 'item-1',
            type: 'audio',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            label: 'Audio',
            src: 'blob:audio',
            audioEqEnabled: true,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'commit-eq' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(timelineState.updateItem).toHaveBeenCalledWith('item-1', {
      audioEqLowGainDb: 6,
      audioEqMidGainDb: 0,
    })
    expect(previewState.clearPreviewForItems).toHaveBeenCalledWith(['item-1'])
    expect(previewState.clearPreview).not.toHaveBeenCalled()
  })
})
