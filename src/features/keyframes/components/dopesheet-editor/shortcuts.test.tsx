import { fireEvent, render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'

describe('DopesheetEditor shortcuts', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('adds a keyframe through the active property handler', () => {
    const onAddKeyframe = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        selectedProperty="x"
        currentFrame={24}
        width={640}
        height={240}
        onAddKeyframe={onAddKeyframe}
        shortcutsEnabled
        shortcuts={{
          addKeyframe: 'k',
          previousKeyframe: 'alt+bracketleft',
          nextKeyframe: 'alt+bracketright',
          toggleAutoKey: 'a',
          fitKeyframes: 'f',
        }}
      />,
    )

    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })

    expect(onAddKeyframe).toHaveBeenCalledWith('x', 24)
  })

  it('does not remove an existing keyframe when adding with the shortcut', () => {
    const onAddKeyframe = vi.fn()
    const onRemoveKeyframes = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 24, value: 100, easing: 'linear' }],
        }}
        selectedProperty="x"
        currentFrame={24}
        width={640}
        height={240}
        onAddKeyframe={onAddKeyframe}
        onRemoveKeyframes={onRemoveKeyframes}
        shortcutsEnabled
        shortcuts={{
          addKeyframe: 'k',
          previousKeyframe: 'alt+bracketleft',
          nextKeyframe: 'alt+bracketright',
          toggleAutoKey: 'a',
          fitKeyframes: 'f',
        }}
      />,
    )

    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })

    expect(onAddKeyframe).not.toHaveBeenCalled()
    expect(onRemoveKeyframes).not.toHaveBeenCalled()
  })

  it('does not fire editor shortcuts while they are out of scope', () => {
    const onAddKeyframe = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        selectedProperty="x"
        currentFrame={24}
        width={640}
        height={240}
        onAddKeyframe={onAddKeyframe}
        shortcutsEnabled={false}
        shortcuts={{
          addKeyframe: 'k',
          previousKeyframe: 'alt+bracketleft',
          nextKeyframe: 'alt+bracketright',
          toggleAutoKey: 'a',
          fitKeyframes: 'f',
        }}
      />,
    )

    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })

    expect(onAddKeyframe).not.toHaveBeenCalled()
  })

  it('keeps only the Edit add shortcut active outside editor focus', () => {
    const onAddKeyframe = vi.fn()
    const onNavigateToKeyframe = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 8, value: 100, easing: 'linear' }],
        }}
        selectedProperty="x"
        currentFrame={24}
        width={640}
        height={240}
        onAddKeyframe={onAddKeyframe}
        onNavigateToKeyframe={onNavigateToKeyframe}
        shortcutsEnabled={false}
        addKeyframeShortcutEnabled
        shortcuts={{
          addKeyframe: 'k',
          previousKeyframe: 'alt+bracketleft',
          nextKeyframe: 'alt+bracketright',
          toggleAutoKey: 'a',
          fitKeyframes: 'f',
        }}
      />,
    )

    fireEvent.keyDown(document, { key: 'k', code: 'KeyK' })
    fireEvent.keyDown(document, {
      key: '[',
      code: 'BracketLeft',
      altKey: true,
    })

    expect(onAddKeyframe).toHaveBeenCalledWith('x', 24)
    expect(onNavigateToKeyframe).not.toHaveBeenCalled()
  })
})
