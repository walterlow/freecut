import { describe, expect, it, vi } from 'vitest'
import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe'
import { handleGraphPaneKeyDown, resolveGraphDisplayProperty } from './dopesheet-graph-display'

const REFS: KeyframeRef[] = [{ itemId: 'item', property: 'x' as AnimatableProperty, keyframeId: 'k1' }]

function pressKey(
  key: string,
  options: {
    disabled?: boolean
    propertyLocked?: boolean
    selectedRefs?: KeyframeRef[]
    canRemove?: boolean
    shiftKey?: boolean
  } = {},
) {
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  const onRemoveKeyframes = vi.fn()
  const onNudge = vi.fn()
  handleGraphPaneKeyDown(
    {
      key,
      shiftKey: options.shiftKey ?? false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault,
      stopPropagation,
    },
    {
      disabled: options.disabled ?? false,
      propertyLocked: options.propertyLocked ?? false,
      selectedRefs: options.selectedRefs ?? REFS,
      onRemoveKeyframes: options.canRemove === false ? undefined : onRemoveKeyframes,
      onNudge,
    },
  )
  return { preventDefault, stopPropagation, onRemoveKeyframes, onNudge }
}

describe('resolveGraphDisplayProperty', () => {
  it('prefers the selected property while it has a curve', () => {
    expect(
      resolveGraphDisplayProperty(new Set(['x', 'y']), ['y'], 'x' as AnimatableProperty),
    ).toBe('y')
  })

  it('falls back to the first visible property with a curve', () => {
    expect(resolveGraphDisplayProperty(new Set(['x', 'y']), ['y'], null)).toBe('y')
  })

  it('keeps a selected property that has no curve rather than showing nothing', () => {
    expect(
      resolveGraphDisplayProperty(new Set(['x']), ['y'], 'x' as AnimatableProperty),
    ).toBe('x')
  })

  it('draws nothing without a visible property', () => {
    expect(resolveGraphDisplayProperty(new Set(), ['x'], 'x' as AnimatableProperty)).toBeNull()
    expect(resolveGraphDisplayProperty(new Set(['x']), [], null)).toBeNull()
  })
})

describe('handleGraphPaneKeyDown', () => {
  it('removes the selection on Delete and Backspace', () => {
    for (const key of ['Delete', 'Backspace']) {
      const { preventDefault, stopPropagation, onRemoveKeyframes } = pressKey(key)
      expect(preventDefault).toHaveBeenCalled()
      expect(stopPropagation).toHaveBeenCalled()
      expect(onRemoveKeyframes).toHaveBeenCalledWith(REFS)
    }
  })

  it('nudges one frame, or ten with Shift', () => {
    expect(pressKey('ArrowLeft').onNudge).toHaveBeenCalledWith(-1)
    expect(pressKey('ArrowRight').onNudge).toHaveBeenCalledWith(1)
  })

  it('leaves keys it does not own to the browser', () => {
    const { preventDefault, stopPropagation, onNudge } = pressKey('a')
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onNudge).not.toHaveBeenCalled()
  })

  it('does not claim Delete when the editor cannot remove keyframes', () => {
    const { preventDefault, onRemoveKeyframes } = pressKey('Delete', { canRemove: false })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onRemoveKeyframes).not.toHaveBeenCalled()
  })

  it('ignores the pane keys while disabled, locked or without a selection', () => {
    for (const overrides of [
      { disabled: true },
      { propertyLocked: true },
      { selectedRefs: [] as KeyframeRef[] },
    ]) {
      const { preventDefault, onRemoveKeyframes, onNudge } = pressKey('Delete', overrides)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onRemoveKeyframes).not.toHaveBeenCalled()
      expect(onNudge).not.toHaveBeenCalled()
    }
  })
})
