import { describe, expect, it } from 'vite-plus/test'
import { TransitionRegistry } from '../registry'
import { registerBasicTransitions } from './basic'

function getFadeRenderer() {
  const registry = new TransitionRegistry()
  registerBasicTransitions(registry)
  const renderer = registry.getRenderer('fade')
  if (!renderer) {
    throw new Error('Missing fade renderer')
  }
  return renderer
}

describe('basic transitions', () => {
  it('renders Fade as a dip through black instead of a crossfade', () => {
    const renderer = getFadeRenderer()

    expect(renderer.calculateStyles(0, true, 1920, 1080)).toEqual({ opacity: 1 })
    expect(renderer.calculateStyles(0, false, 1920, 1080)).toEqual({ opacity: 0 })
    expect(renderer.calculateStyles(0.5, true, 1920, 1080)).toEqual({ opacity: 0 })
    expect(renderer.calculateStyles(0.5, false, 1920, 1080)).toEqual({ opacity: 0 })
    expect(renderer.calculateStyles(1, true, 1920, 1080)).toEqual({ opacity: 0 })
    expect(renderer.calculateStyles(1, false, 1920, 1080)).toEqual({ opacity: 1 })
  })
})
