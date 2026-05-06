import { describe, expect, it } from 'vite-plus/test'
import { TransitionRegistry } from '../registry'
import { registerIrisTransitions } from './iris'
import { getClockWipeMaskState, getIrisMaskState, registerMaskTransitions } from './mask'
import { registerMotionTransitions } from './motion'
import { getAperturePath, registerShapeTransitions } from './shape'
import { registerWipeTransitions } from './wipe'

function getRenderer(id: 'clockWipe' | 'iris') {
  const registry = new TransitionRegistry()
  registerMaskTransitions(registry)
  const renderer = registry.getRenderer(id)
  if (!renderer) {
    throw new Error(`Missing renderer for ${id}`)
  }
  return renderer
}

describe('mask transitions', () => {
  it('keeps clock wipe endpoints crisp in the CSS preview path', () => {
    const renderer = getRenderer('clockWipe')

    expect(renderer.calculateStyles(0, true, 1920, 1080, undefined, { edgeSoftness: 12 })).toEqual({
      opacity: 1,
    })
    expect(renderer.calculateStyles(1, true, 1920, 1080, undefined, { edgeSoftness: 12 })).toEqual({
      opacity: 0,
    })

    const midpoint = renderer.calculateStyles(0.5, true, 1920, 1080, undefined, {
      edgeSoftness: 12,
    })
    expect(midpoint.maskImage).toContain('conic-gradient')
  })

  it('collapses clock wipe feathering when the sweep is at either endpoint', () => {
    expect(getClockWipeMaskState(0, 12)).toEqual({
      degrees: 0,
      effectiveEdgeSoftness: 0,
    })
    expect(getClockWipeMaskState(1, 12)).toEqual({
      degrees: 360,
      effectiveEdgeSoftness: 0,
    })
    expect(getClockWipeMaskState(0.5, 12)).toEqual({
      degrees: 180,
      effectiveEdgeSoftness: 12,
    })
  })

  it('shrinks iris feathering as the aperture approaches open or closed', () => {
    const renderer = getRenderer('iris')
    const start = getIrisMaskState(0, 1920, 1080, 32)
    const nearStart = getIrisMaskState(0.01, 1920, 1080, 32)
    const midpoint = getIrisMaskState(0.5, 1920, 1080, 32)
    const nearEnd = getIrisMaskState(0.99, 1920, 1080, 32)
    const end = getIrisMaskState(1, 1920, 1080, 32)

    expect(start.radius).toBe(0)
    expect(start.effectiveEdgeSoftness).toBe(0)
    expect(nearStart.effectiveEdgeSoftness).toBeCloseTo(nearStart.radius, 5)
    expect(midpoint.effectiveEdgeSoftness).toBe(32)
    expect(nearEnd.effectiveEdgeSoftness).toBeCloseTo(nearEnd.maxRadius - nearEnd.radius, 5)
    expect(end.effectiveEdgeSoftness).toBe(0)

    expect(renderer.calculateStyles(0, true, 1920, 1080, undefined, { edgeSoftness: 32 })).toEqual({
      opacity: 1,
    })
    expect(renderer.calculateStyles(1, true, 1920, 1080, undefined, { edgeSoftness: 32 })).toEqual({
      opacity: 0,
    })
  })
})

describe('iris transitions', () => {
  it('registers the DaVinci-style iris behavior variants', () => {
    const registry = new TransitionRegistry()
    registerIrisTransitions(registry)

    expect(registry.getByCategory('iris').map((entry) => entry.definition.label)).toEqual([
      'Arrow Iris',
      'Cross Iris',
      'Diamond Iris',
      'Eye Iris',
      'Hexagon Iris',
      'Oval Iris',
      'Pentagon Iris',
      'Square Iris',
      'Triangle Iris',
    ])
  })

  it('builds an outgoing SVG aperture mask for polygon iris variants', () => {
    const registry = new TransitionRegistry()
    registerIrisTransitions(registry)
    const renderer = registry.getRenderer('diamondIris')

    expect(renderer?.calculateStyles(0, true, 1920, 1080)).toEqual({ opacity: 1 })
    expect(renderer?.calculateStyles(1, true, 1920, 1080)).toEqual({ opacity: 0 })

    const midpoint = renderer?.calculateStyles(0.5, true, 1920, 1080)
    expect(midpoint?.maskImage).toContain('data:image/svg+xml')
    expect(midpoint?.webkitMaskImage).toBe(midpoint?.maskImage)
  })
})

describe('motion transitions', () => {
  it('registers barn door and split in the Motion category', () => {
    const registry = new TransitionRegistry()
    registerMotionTransitions(registry)

    expect(registry.getByCategory('motion').map((entry) => entry.definition.label)).toEqual([
      'Barn Door',
      'Split',
    ])
  })

  it('builds outgoing SVG masks for motion split reveals', () => {
    const registry = new TransitionRegistry()
    registerMotionTransitions(registry)
    const renderer = registry.getRenderer('barnDoor')

    expect(renderer?.calculateStyles(0, true, 1920, 1080)).toEqual({ opacity: 1 })
    expect(renderer?.calculateStyles(1, true, 1920, 1080)).toEqual({ opacity: 0 })

    const midpoint = renderer?.calculateStyles(0.5, true, 1920, 1080)
    expect(midpoint?.maskImage).toContain('data:image/svg+xml')
  })
})

describe('shape transitions', () => {
  function getPathBounds(path: string): { minX: number; maxX: number; minY: number; maxY: number } {
    const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
    const xs = numbers.filter((_, index) => index % 2 === 0)
    const ys = numbers.filter((_, index) => index % 2 === 1)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  it('registers the DaVinci-style shape variants', () => {
    const registry = new TransitionRegistry()
    registerShapeTransitions(registry)

    expect(registry.getByCategory('shape').map((entry) => entry.definition.label)).toEqual([
      'Box',
      'Heart',
      'Star',
      'Triangle Left',
      'Triangle Right',
    ])
  })

  it('builds outgoing SVG masks for shape reveals', () => {
    const registry = new TransitionRegistry()
    registerShapeTransitions(registry)
    const renderer = registry.getRenderer('heartShape')

    expect(renderer?.calculateStyles(0, true, 1920, 1080)).toEqual({ opacity: 1 })
    expect(renderer?.calculateStyles(1, true, 1920, 1080)).toEqual({ opacity: 0 })

    const midpoint = renderer?.calculateStyles(0.5, true, 1920, 1080)
    expect(midpoint?.maskImage).toContain('data:image/svg+xml')
  })

  it('keeps box aperture from covering the whole frame by the midpoint', () => {
    const width = 1920
    const height = 1080

    const midpoint = getPathBounds(getAperturePath('box', width, height, 0.5))
    const coversAllEdges =
      midpoint.minX < 0 && midpoint.maxX > width && midpoint.minY < 0 && midpoint.maxY > height
    expect(coversAllEdges).toBe(false)
  })

  it('overscans box aperture at the exit frame to prevent a pop', () => {
    const width = 1920
    const height = 1080

    const bounds = getPathBounds(getAperturePath('box', width, height, 1))

    expect(bounds.minX).toBeLessThan(0)
    expect(bounds.maxX).toBeGreaterThan(width)
    expect(bounds.minY).toBeLessThan(0)
    expect(bounds.maxY).toBeGreaterThan(height)
  })

  it('keeps corner triangle apertures from covering the whole frame by the midpoint', () => {
    const width = 1920
    const height = 1080

    const leftMidpoint = getPathBounds(getAperturePath('triangleLeft', width, height, 0.5))
    const rightMidpoint = getPathBounds(getAperturePath('triangleRight', width, height, 0.5))

    expect(leftMidpoint.maxX).toBeLessThan(width * 1.2)
    expect(leftMidpoint.maxY).toBeLessThan(height * 1.2)
    expect(rightMidpoint.minX).toBeGreaterThan(width * -0.2)
    expect(rightMidpoint.maxY).toBeLessThan(height * 1.2)
  })

  it('overscans corner triangle apertures at the exit frame to prevent a pop', () => {
    const width = 1920
    const height = 1080

    const leftBounds = getPathBounds(getAperturePath('triangleLeft', width, height, 1))
    const rightBounds = getPathBounds(getAperturePath('triangleRight', width, height, 1))

    expect(leftBounds.maxX).toBeGreaterThan(width * 2)
    expect(leftBounds.maxY).toBeGreaterThan(height * 2)
    expect(rightBounds.minX).toBeLessThan(-width)
    expect(rightBounds.maxY).toBeGreaterThan(height * 2)
  })
})

describe('wipe transitions', () => {
  it('registers the DaVinci-style wipe variants', () => {
    const registry = new TransitionRegistry()
    registerWipeTransitions(registry)
    registerMaskTransitions(registry)

    expect(registry.getByCategory('wipe').map((entry) => entry.definition.label)).toEqual([
      'Band Wipe',
      'Center Wipe',
      'Clock Wipe',
      'Edge Wipe',
      'Radial Wipe',
      'Spiral Wipe',
      'Venetian Blind Wipe',
      'X Wipe',
    ])
  })

  it('builds outgoing SVG masks for wipe reveals', () => {
    const registry = new TransitionRegistry()
    registerWipeTransitions(registry)
    const renderer = registry.getRenderer('bandWipe')

    expect(renderer?.calculateStyles(0, true, 1920, 1080)).toEqual({ opacity: 1 })
    expect(renderer?.calculateStyles(1, true, 1920, 1080)).toEqual({ opacity: 0 })

    const midpoint = renderer?.calculateStyles(0.5, true, 1920, 1080)
    expect(midpoint?.maskImage).toContain('data:image/svg+xml')
  })

  it('registers edge wipe with all four directions', () => {
    const registry = new TransitionRegistry()
    registerWipeTransitions(registry)

    const definition = registry.getDefinition('edgeWipe')

    expect(definition).toMatchObject({
      hasDirection: true,
      directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
    })
  })

  it('builds directional edge wipe masks', () => {
    const registry = new TransitionRegistry()
    registerWipeTransitions(registry)
    const renderer = registry.getRenderer('edgeWipe')

    const fromLeft = renderer?.calculateStyles(0.5, true, 100, 80, 'from-left').maskImage
    const fromRight = renderer?.calculateStyles(0.5, true, 100, 80, 'from-right').maskImage
    const fromTop = renderer?.calculateStyles(0.5, true, 100, 80, 'from-top').maskImage
    const fromBottom = renderer?.calculateStyles(0.5, true, 100, 80, 'from-bottom').maskImage

    expect(new Set([fromLeft, fromRight, fromTop, fromBottom]).size).toBe(4)
  })
})
