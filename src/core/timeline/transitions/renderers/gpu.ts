/**
 * GPU Transition Renderers
 *
 * Registers WebGPU-accelerated transitions into the transition registry.
 * Each GPU transition provides:
 * - calculateStyles: CSS approximation for DOM preview
 * - renderCanvas: Canvas 2D fallback for non-GPU environments
 * - gpuTransitionId: ID for GPU-accelerated rendering via TransitionPipeline
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry'
import type { TransitionStyleCalculation } from '../engine'
import type { TransitionDefinition, WipeDirection } from '@/types/transition'

const ALL_TIMINGS = [
  'linear',
  'spring',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier',
] as const

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function smoothStep(edge0: number, edge1: number, x: number): number {
  const width = Math.max(edge1 - edge0, Number.EPSILON)
  const t = clamp01((x - edge0) / width)
  return t * t * (3 - 2 * t)
}

function getNumericProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = properties?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return value
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123
  return x - Math.floor(x)
}

function fadeOpacity(progress: number, isOutgoing: boolean): number {
  return isOutgoing ? Math.cos((progress * Math.PI) / 2) : Math.sin((progress * Math.PI) / 2)
}

function crossDissolveT(progress: number): number {
  return 0.5 - 0.5 * Math.cos(clamp01(progress) * Math.PI)
}

function renderCrossDissolveCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas?: { width: number; height: number },
): void {
  const t = crossDissolveT(progress)
  const w = canvas?.width ?? leftCanvas.width
  const h = canvas?.height ?? leftCanvas.height

  ctx.save()
  ctx.globalCompositeOperation = 'copy'
  ctx.globalAlpha = 1
  ctx.drawImage(leftCanvas, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = t
  ctx.drawImage(rightCanvas, 0, 0, w, h)
  ctx.restore()
}

function renderDipToColorCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas?: { width: number; height: number },
  properties?: Record<string, unknown>,
): void {
  const p = clamp01(progress)
  const w = canvas?.width ?? leftCanvas.width
  const h = canvas?.height ?? leftCanvas.height
  const colorWeight = p < 0.5 ? smoothStep(0, 0.5, p) : 1 - smoothStep(0.5, 1, p)
  const color = properties?.color
  const rgb = Array.isArray(color) ? color : [0, 0, 0]
  const r = Math.round(clamp01(typeof rgb[0] === 'number' ? rgb[0] : 0) * 255)
  const g = Math.round(clamp01(typeof rgb[1] === 'number' ? rgb[1] : 0) * 255)
  const b = Math.round(clamp01(typeof rgb[2] === 'number' ? rgb[2] : 0) * 255)

  ctx.save()
  ctx.globalCompositeOperation = 'copy'
  ctx.globalAlpha = 1
  ctx.drawImage(p < 0.5 ? leftCanvas : rightCanvas, 0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = colorWeight
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

function traceSparklePath(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  innerRadius: number,
  rotation: number,
): void {
  ctx.beginPath()
  for (let i = 0; i < 8; i += 1) {
    const angle = rotation + (Math.PI / 4) * i
    const r = i % 2 === 0 ? radius : innerRadius
    const px = x + Math.cos(angle) * r
    const py = y + Math.sin(angle) * r
    if (i === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.lineTo(px, py)
    }
  }
  ctx.closePath()
}

function fillSparkleShape(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  innerRadius: number,
  rotation: number,
  stretchX = 1,
  stretchY = 1,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(stretchX, stretchY)
  traceSparklePath(ctx, 0, 0, radius, innerRadius, 0)
  ctx.fill()
  ctx.restore()
}

function renderSparklesCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  leftCanvas: OffscreenCanvas,
  rightCanvas: OffscreenCanvas,
  progress: number,
  canvas?: { width: number; height: number },
  properties?: Record<string, unknown>,
): void {
  const p = clamp01(progress)
  const w = canvas?.width ?? leftCanvas.width
  const h = canvas?.height ?? leftCanvas.height
  const sparkleScale = Math.max(0.55, getNumericProperty(properties, 'sparkleScale', 1))
  const intensity = Math.max(0.35, getNumericProperty(properties, 'intensity', 1))
  const density = Math.max(0.5, getNumericProperty(properties, 'density', 1))
  const glow = Math.max(0, getNumericProperty(properties, 'glow', 1))
  const outgoingHold = 1 - smoothStep(0.74, 1, p)

  ctx.save()
  ctx.drawImage(rightCanvas, 0, 0, w, h)
  ctx.restore()

  const leftLayer = new OffscreenCanvas(w, h)
  const leftCtx = leftLayer.getContext('2d')
  if (!leftCtx) {
    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.restore()
    return
  }

  leftCtx.clearRect(0, 0, w, h)
  leftCtx.save()
  leftCtx.drawImage(leftCanvas, 0, 0, w, h)
  leftCtx.restore()

  const sparkleCount = Math.round(24 + density * 22)
  const glowBursts: Array<{
    x: number
    y: number
    radius: number
    alpha: number
    veilRadius: number
  }> = []

  for (let i = 0; i < sparkleCount; i += 1) {
    const seed = i + 1
    const revealPoint = Math.min(
      0.94,
      0.04 + seededRandom(seed * 31.7) * 0.72 + seededRandom(seed * 7.9) * 0.16,
    )
    const igniteDuration = 0.14 + seededRandom(seed * 41.9) * 0.18
    const igniteProgress = clamp01((p - revealPoint) / igniteDuration)
    const igniteIn = smoothStep(0, 0.16, igniteProgress)
    const igniteOut = 1 - smoothStep(0.3, 0.95, igniteProgress)
    const activation = igniteIn * igniteOut
    const afterglow = smoothStep(0.06, 0.72, igniteProgress)
    if (activation <= 0.01 && afterglow <= 0.02) continue

    const twinklePhase =
      igniteProgress * (3.6 + seededRandom(seed * 5.3) * 3.8) + seededRandom(seed * 11.1)
    const twinkle = 0.35 + 0.65 * ((Math.sin(twinklePhase * Math.PI * 2) + 1) / 2)
    const alpha = Math.min(1, activation * twinkle * intensity)
    const breakupAlpha = Math.min(1, afterglow * (0.25 + twinkle * 0.35) * intensity)

    const baseX = seededRandom(seed * 13.1) * w
    const baseY = seededRandom(seed * 17.9) * h
    const sizeSeed = Math.pow(seededRandom(seed * 19.7), 0.55)
    const radius = (4 + sizeSeed * 34) * sparkleScale * (0.55 + activation * 1.15)
    const angle = seededRandom(seed * 23.3) * Math.PI * 2
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    const drift = (10 + sizeSeed * 28) * activation
    const orbitRadius = (3 + sizeSeed * 10) * activation
    const orbitAngle = angle + igniteProgress * (2.4 + seededRandom(seed * 29.1) * 4.5) * Math.PI
    const x = baseX + dirX * drift + Math.cos(orbitAngle) * orbitRadius
    const y = baseY + dirY * drift + Math.sin(orbitAngle) * orbitRadius * 0.8
    const rotation = angle + igniteProgress * (2 + sizeSeed * 3.5) * Math.PI

    leftCtx.save()
    leftCtx.globalCompositeOperation = 'destination-out'
    leftCtx.globalAlpha = alpha
    leftCtx.fillStyle = 'rgba(0, 0, 0, 1)'
    fillSparkleShape(leftCtx, x, y, radius, radius * 0.24, rotation)

    leftCtx.globalAlpha = alpha * 0.46
    fillSparkleShape(
      leftCtx,
      x - dirX * radius * 0.9,
      y - dirY * radius * 0.9,
      radius * 0.78,
      radius * 0.14,
      rotation - 0.45,
      1.9,
      0.58,
    )

    leftCtx.globalAlpha = alpha * 0.22
    fillSparkleShape(
      leftCtx,
      x - dirX * radius * 1.55,
      y - dirY * radius * 1.55,
      radius * 0.52,
      radius * 0.12,
      rotation - 0.7,
      2.4,
      0.42,
    )

    const dustCount = 3 + Math.round(sizeSeed * 2)
    leftCtx.globalAlpha = breakupAlpha * 0.08
    for (let dustIndex = 0; dustIndex < dustCount; dustIndex += 1) {
      const dustSeed = seed * 53.1 + dustIndex * 7.3
      const dustAngle = seededRandom(dustSeed) * Math.PI * 2
      const dustDistance = radius * (1.3 + seededRandom(dustSeed * 1.7) * 2.1) * (0.5 + afterglow)
      const dustRadius = radius * (0.14 + seededRandom(dustSeed * 2.9) * 0.24) * (0.55 + afterglow)
      leftCtx.beginPath()
      leftCtx.arc(
        x + Math.cos(dustAngle) * dustDistance,
        y + Math.sin(dustAngle) * dustDistance * 0.85,
        dustRadius,
        0,
        Math.PI * 2,
      )
      leftCtx.fill()
    }

    leftCtx.beginPath()
    leftCtx.arc(x, y, radius * 0.24, 0, Math.PI * 2)
    leftCtx.fill()
    leftCtx.restore()

    glowBursts.push({
      x,
      y,
      radius: radius * 2.6,
      alpha: Math.min(1, alpha + breakupAlpha * 0.45),
      veilRadius: radius * 5.4,
    })
  }

  if (glowBursts.length > 0 && glow > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (const burst of glowBursts) {
      const veil = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, burst.veilRadius)
      veil.addColorStop(0, `rgba(255, 245, 228, ${0.12 * burst.alpha * glow})`)
      veil.addColorStop(0.45, `rgba(255, 226, 184, ${0.06 * burst.alpha * glow})`)
      veil.addColorStop(1, 'rgba(255, 214, 165, 0)')
      ctx.fillStyle = veil
      ctx.fillRect(
        burst.x - burst.veilRadius,
        burst.y - burst.veilRadius,
        burst.veilRadius * 2,
        burst.veilRadius * 2,
      )
    }
    ctx.restore()
  }

  ctx.save()
  ctx.globalAlpha = outgoingHold
  ctx.drawImage(leftLayer, 0, 0)
  ctx.restore()

  if (glowBursts.length === 0 || glow <= 0) {
    return
  }

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const burst of glowBursts) {
    const gradient = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, burst.radius)
    gradient.addColorStop(0, `rgba(255, 252, 240, ${0.38 * burst.alpha * glow})`)
    gradient.addColorStop(0.32, `rgba(255, 224, 170, ${0.26 * burst.alpha * glow})`)
    gradient.addColorStop(1, 'rgba(255, 210, 150, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(burst.x - burst.radius, burst.y - burst.radius, burst.radius * 2, burst.radius * 2)
  }
  ctx.restore()
}

// ============================================================================
// Dissolve
// ============================================================================

const dissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'dissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const t = crossDissolveT(progress)
    return { opacity: isOutgoing ? 1 - t : t }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    renderCrossDissolveCanvas(ctx, leftCanvas, rightCanvas, progress, canvas)
  },
}

const dissolveDef: TransitionDefinition = {
  id: 'dissolve',
  label: 'Cross Dissolve',
  description: 'Smooth opacity blend between clips',
  category: 'dissolve',
  icon: 'Blend',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
}

const additiveDissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'additiveDissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    return { opacity: isOutgoing ? 1 - p : p }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    ctx.save()
    ctx.globalCompositeOperation = 'copy'
    ctx.globalAlpha = 1 - p
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = p
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()
  },
}

const additiveDissolveDef: TransitionDefinition = {
  id: 'additiveDissolve',
  label: 'Additive Dissolve',
  description: 'Bright additive blend that flashes through overlapping highlights',
  category: 'dissolve',
  icon: 'Layers',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
}

const blurDissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'blurDissolve',
  calculateStyles(
    progress,
    isOutgoing,
    _canvasWidth,
    _canvasHeight,
    _direction,
    properties,
  ): TransitionStyleCalculation {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const strength = getNumericProperty(properties, 'strength', 9) / 9
    return {
      opacity: isOutgoing ? 1 - p : p,
      transform: envelope > 0.05 ? `scale(${1 + envelope * 0.006 * strength})` : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas, properties) {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const strength = getNumericProperty(properties, 'strength', 9)
    ctx.save()
    ctx.filter = `blur(${(envelope * strength).toFixed(2)}px)`
    renderCrossDissolveCanvas(ctx, leftCanvas, rightCanvas, p, canvas)
    ctx.restore()
  },
}

const blurDissolveDef: TransitionDefinition = {
  id: 'blurDissolve',
  label: 'Blur Dissolve',
  description: 'Cross dissolve with a soft midpoint blur',
  category: 'dissolve',
  icon: 'Droplet',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
  parameters: [
    {
      key: 'strength',
      label: 'Blur',
      type: 'number',
      defaultValue: 9,
      min: 0,
      max: 24,
      step: 0.5,
      unit: 'px',
      description: 'Maximum midpoint blur',
    },
  ],
}

const dipToColorDissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'dipToColorDissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    if (p < 0.5) return { opacity: isOutgoing ? 1 - smoothStep(0, 0.5, p) : 0 }
    return { opacity: isOutgoing ? 0 : smoothStep(0.5, 1, p) }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas, properties) {
    renderDipToColorCanvas(ctx, leftCanvas, rightCanvas, progress, canvas, properties)
  },
}

const dipToColorDissolveDef: TransitionDefinition = {
  id: 'dipToColorDissolve',
  label: 'Dip To Color Dissolve',
  description: 'Dissolve through a solid color, defaulting to black',
  category: 'dissolve',
  icon: 'Circle',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
  parameters: [
    {
      key: 'color',
      label: 'Color',
      type: 'color',
      defaultValue: [0, 0, 0],
      description: 'Color used at the midpoint of the dissolve',
      valueFormat: 'rgb-array',
    },
  ],
}

const nonAdditiveDissolveRenderer: TransitionRenderer = {
  gpuTransitionId: 'nonAdditiveDissolve',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    return { opacity: isOutgoing ? 1 - p : p }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    renderCrossDissolveCanvas(ctx, leftCanvas, rightCanvas, progress, canvas)
  },
}

const nonAdditiveDissolveDef: TransitionDefinition = {
  id: 'nonAdditiveDissolve',
  label: 'Non-Additive Dissolve',
  description: 'Neutral dissolve that avoids the bright overlap of additive blends',
  category: 'dissolve',
  icon: 'Columns2',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
}

const smoothCutRenderer: TransitionRenderer = {
  gpuTransitionId: 'smoothCut',
  calculateStyles(
    progress,
    isOutgoing,
    _canvasWidth,
    _canvasHeight,
    _direction,
    properties,
  ): TransitionStyleCalculation {
    const p = clamp01(progress)
    const t = smoothStep(0.22, 0.78, p)
    const envelope = Math.sin(p * Math.PI)
    const strength = getNumericProperty(properties, 'strength', 0.9)
    return {
      opacity: isOutgoing ? 1 - t : t,
      transform:
        envelope > 0.05
          ? `translateX(${((isOutgoing ? -1 : 1) * envelope * 4 * strength).toFixed(2)}px) skewX(${((isOutgoing ? -1 : 1) * envelope * 0.7 * strength).toFixed(2)}deg)`
          : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas, properties) {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const t = smoothStep(0.22, 0.78, p)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const strength = getNumericProperty(properties, 'strength', 0.9)
    const drift = envelope * 4 * strength
    const skew = 0.012 * envelope * strength
    const driftPx = Math.round(drift)

    ctx.save()
    ctx.globalCompositeOperation = 'copy'
    ctx.globalAlpha = 1
    ctx.setTransform(1, 0, -skew, 1, -driftPx, 0)
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = t
    ctx.setTransform(1, 0, skew, 1, driftPx, 0)
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()
  },
}

const smoothCutDef: TransitionDefinition = {
  id: 'smoothCut',
  label: 'Smooth Cut',
  description: 'Subtle liquid-warp blend for jump-cut style edits',
  category: 'dissolve',
  icon: 'Waves',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 18,
  minDuration: 6,
  maxDuration: 45,
  parameters: [
    {
      key: 'strength',
      label: 'Warp',
      type: 'number',
      defaultValue: 0.9,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Horizontal liquid warp strength',
    },
  ],
}

// ============================================================================
// Sparkles
// ============================================================================

const sparklesRenderer: TransitionRenderer = {
  gpuTransitionId: 'sparkles',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const phase = isOutgoing ? 0.2 : 1.05
    const drift = 14 * envelope
    const x = Math.sin(p * Math.PI * 2.2 + phase) * drift * 0.55
    const y = Math.cos(p * Math.PI * 1.6 + phase) * drift * 0.28
    const rotate = Math.sin(p * Math.PI * 1.8 + phase) * envelope * 1.6
    const scale = isOutgoing ? 1 - 0.03 * p : 1.03 - 0.03 * p
    const opacity = isOutgoing ? 1 - smoothStep(0.2, 0.94, p) : smoothStep(0.06, 0.8, p)

    return {
      opacity,
      transform:
        envelope > 0.08
          ? `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scale})`
          : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas, properties) {
    renderSparklesCanvas(ctx, leftCanvas, rightCanvas, progress, canvas, properties)
  },
}

const sparklesDef: TransitionDefinition = {
  id: 'sparkles',
  label: 'Sparkles',
  description: 'Twinkling star bursts reveal the next clip',
  category: 'custom',
  icon: 'Sparkles',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 24,
  minDuration: 8,
  maxDuration: 72,
  parameters: [
    {
      key: 'sparkleScale',
      label: 'Size',
      type: 'number',
      defaultValue: 1,
      min: 0.25,
      max: 3,
      step: 0.05,
      description: 'Sparkle particle size',
    },
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 2.5,
      step: 0.05,
      description: 'Overall sparkle brightness',
    },
    {
      key: 'density',
      label: 'Density',
      type: 'number',
      defaultValue: 1,
      min: 0.2,
      max: 3,
      step: 0.05,
      description: 'Amount of sparkle particles',
    },
    {
      key: 'glow',
      label: 'Glow',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Soft sparkle bloom',
    },
  ],
}

// ============================================================================
// Glitch
// ============================================================================

const glitchRenderer: TransitionRenderer = {
  gpuTransitionId: 'glitch',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: hard cut with deterministic jitter
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const offset = Math.sin(p * 47) * envelope * 5
    const midpoint = 0.5

    if (isOutgoing) {
      return {
        opacity: p < midpoint ? 1 : 0,
        transform: envelope > 0.2 ? `translateX(${offset}px)` : undefined,
      }
    }
    return {
      opacity: p >= midpoint ? 1 : 0,
      transform: envelope > 0.2 ? `translateX(${-offset}px)` : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: simple hard cut
    const p = clamp01(progress)
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0)
    } else {
      ctx.drawImage(rightCanvas, 0, 0)
    }
  },
}

const glitchDef: TransitionDefinition = {
  id: 'glitch',
  label: 'Glitch',
  description: 'Digital glitch with RGB split and block displacement',
  category: 'custom',
  icon: 'Zap',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 5,
  maxDuration: 60,
  parameters: [
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Overall glitch displacement',
    },
    {
      key: 'blockSize',
      label: 'Blocks',
      type: 'number',
      defaultValue: 30,
      min: 6,
      max: 96,
      step: 1,
      unit: 'px',
      description: 'Digital block size',
    },
    {
      key: 'rgbSplit',
      label: 'RGB Split',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Color channel offset',
    },
  ],
}

// ============================================================================
// Pixelate
// ============================================================================

const pixelateRenderer: TransitionRenderer = {
  gpuTransitionId: 'pixelate',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade (GPU version does mosaic pixelation)
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: hard cut at midpoint
    const p = clamp01(progress)
    if (p < 0.5) {
      ctx.drawImage(leftCanvas, 0, 0)
    } else {
      ctx.drawImage(rightCanvas, 0, 0)
    }
  },
}

const pixelateDef: TransitionDefinition = {
  id: 'pixelate',
  label: 'Pixelate',
  description: 'Mosaic pixelation dissolve between clips',
  category: 'custom',
  icon: 'Grid3x3',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 20,
  minDuration: 8,
  maxDuration: 60,
  parameters: [
    {
      key: 'maxBlockSize',
      label: 'Block Size',
      type: 'number',
      defaultValue: 48,
      min: 4,
      max: 160,
      step: 1,
      unit: 'px',
      description: 'Largest mosaic block size',
    },
  ],
}

// ============================================================================
// Chromatic
// ============================================================================

const chromaticRenderer: TransitionRenderer = {
  gpuTransitionId: 'chromatic',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight blur
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    // Canvas 2D fallback: directional crossfade
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, false)
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.restore()
  },
}

const chromaticDef: TransitionDefinition = {
  id: 'chromatic',
  label: 'Chromatic',
  description: 'RGB channel split with directional sweep',
  category: 'custom',
  icon: 'Aperture',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
  parameters: [
    {
      key: 'spread',
      label: 'Spread',
      type: 'number',
      defaultValue: 1.5,
      min: 0,
      max: 5,
      step: 0.05,
      description: 'Channel separation distance',
    },
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Chromatic sweep strength',
    },
  ],
}

// ============================================================================
// Radial Blur
// ============================================================================

const radialBlurRenderer: TransitionRenderer = {
  gpuTransitionId: 'radialBlur',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    // CSS approximation: crossfade with slight scale
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const scale = 1 + envelope * 0.02
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform: envelope > 0.1 ? `scale(${scale})` : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress) {
    // Canvas 2D fallback: crossfade
    const p = clamp01(progress)
    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, false)
    ctx.drawImage(rightCanvas, 0, 0)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, 0, 0)
    ctx.restore()
  },
}

const radialBlurDef: TransitionDefinition = {
  id: 'radialBlur',
  label: 'Radial Blur',
  description: 'Zoom and spin blur transition',
  category: 'custom',
  icon: 'CircleDot',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 25,
  minDuration: 10,
  maxDuration: 60,
  parameters: [
    {
      key: 'blurStrength',
      label: 'Blur',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Radial blur amount',
    },
    {
      key: 'spin',
      label: 'Spin',
      type: 'number',
      defaultValue: 0.3,
      min: -1.5,
      max: 1.5,
      step: 0.05,
      description: 'Rotational blur twist',
    },
  ],
}

// ============================================================================
// Liquid Distort
// ============================================================================

const liquidDistortRenderer: TransitionRenderer = {
  gpuTransitionId: 'liquidDistort',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const offset = Math.sin(p * Math.PI * 2.4) * envelope * 3
    const scale = isOutgoing ? 1 + envelope * 0.012 : 1 + envelope * 0.018
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform:
        envelope > 0.08 ? `translate(${offset}px, ${-offset * 0.45}px) scale(${scale})` : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const envelope = Math.sin(p * Math.PI)
    const offset = Math.sin(p * Math.PI * 2.4) * envelope * 5

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, false)
    ctx.drawImage(rightCanvas, offset, -offset * 0.35, w, h)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, -offset * 0.65, offset * 0.25, w, h)
    ctx.restore()

    if (envelope <= 0.08) return

    const gradient = ctx.createLinearGradient(0, 0, w, h)
    gradient.addColorStop(0, `rgba(180, 225, 255, ${0.12 * envelope})`)
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.08 * envelope})`)
    gradient.addColorStop(1, 'rgba(180, 225, 255, 0)')
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  },
}

const liquidDistortDef: TransitionDefinition = {
  id: 'liquidDistort',
  label: 'Liquid Distort',
  description: 'Fluid glass distortion with a turbulent reveal edge',
  category: 'custom',
  icon: 'Waves',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 28,
  minDuration: 10,
  maxDuration: 90,
  parameters: [
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 2.5,
      step: 0.05,
      description: 'Overall distortion strength',
    },
    {
      key: 'scale',
      label: 'Scale',
      type: 'number',
      defaultValue: 4.5,
      min: 1,
      max: 12,
      step: 0.1,
      description: 'Noise pattern scale',
    },
    {
      key: 'turbulence',
      label: 'Turbulence',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Fluid noise turbulence',
    },
    {
      key: 'chroma',
      label: 'Chroma',
      type: 'number',
      defaultValue: 0.75,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Color separation around distortion',
    },
    {
      key: 'swirl',
      label: 'Swirl',
      type: 'number',
      defaultValue: 0.8,
      min: 0,
      max: 2.5,
      step: 0.05,
      description: 'Curling warp motion',
    },
    {
      key: 'shine',
      label: 'Shine',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Specular highlight strength',
    },
  ],
}

// ============================================================================
// Lens Warp Zoom
// ============================================================================

const lensWarpZoomRenderer: TransitionRenderer = {
  gpuTransitionId: 'lensWarpZoom',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const zoom = isOutgoing ? 1 + p * 0.18 + envelope * 0.04 : 1.18 - p * 0.18 + envelope * 0.03
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform: `scale(${zoom})`,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const envelope = Math.sin(p * Math.PI)

    const drawScaled = (source: OffscreenCanvas, scale: number, alpha: number) => {
      const dw = w * scale
      const dh = h * scale
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh)
      ctx.restore()
    }

    drawScaled(rightCanvas, 1.18 - p * 0.18 + envelope * 0.02, fadeOpacity(p, false))
    drawScaled(leftCanvas, 1 + p * 0.18 + envelope * 0.03, fadeOpacity(p, true))

    if (envelope <= 0.08) return

    const radius = Math.min(w, h) * (0.22 + p * 0.18)
    const glow = ctx.createRadialGradient(w / 2, h / 2, radius * 0.35, w / 2, h / 2, radius)
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.12 * envelope})`)
    glow.addColorStop(0.55, `rgba(190, 225, 255, ${0.08 * envelope})`)
    glow.addColorStop(1, 'rgba(190, 225, 255, 0)')
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  },
}

const lensWarpZoomDef: TransitionDefinition = {
  id: 'lensWarpZoom',
  label: 'Lens Warp Zoom',
  description: 'Punchy zoom with barrel warp, blur, and chromatic edge shimmer',
  category: 'custom',
  icon: 'ScanSearch',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 24,
  minDuration: 8,
  maxDuration: 72,
  parameters: [
    {
      key: 'zoomStrength',
      label: 'Zoom',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 2.5,
      step: 0.05,
      description: 'Zoom punch amount',
    },
    {
      key: 'warpStrength',
      label: 'Warp',
      type: 'number',
      defaultValue: 0.75,
      min: 0,
      max: 2.5,
      step: 0.05,
      description: 'Barrel warp strength',
    },
    {
      key: 'blurStrength',
      label: 'Blur',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Lens blur amount',
    },
    {
      key: 'chroma',
      label: 'Chroma',
      type: 'number',
      defaultValue: 0.65,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Chromatic lens edge',
    },
    {
      key: 'vignette',
      label: 'Vignette',
      type: 'number',
      defaultValue: 0.7,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Edge darkening',
    },
    {
      key: 'glow',
      label: 'Glow',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Center glow intensity',
    },
  ],
}

// ============================================================================
// Light Leak Burn
// ============================================================================

const lightLeakBurnRenderer: TransitionRenderer = {
  gpuTransitionId: 'lightLeakBurn',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    return { opacity: fadeOpacity(clamp01(progress), isOutgoing) }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const dir = (direction as WipeDirection) || 'from-left'
    const envelope = Math.sin(p * Math.PI)

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, false)
    ctx.drawImage(rightCanvas, 0, 0, w, h)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, 0, 0, w, h)
    ctx.restore()

    if (envelope <= 0.06) return

    const gx =
      dir === 'from-right'
        ? (1 - p) * w
        : dir === 'from-top' || dir === 'from-bottom'
          ? w / 2
          : p * w
    const gy =
      dir === 'from-bottom'
        ? (1 - p) * h
        : dir === 'from-left' || dir === 'from-right'
          ? h / 2
          : p * h
    const radius = Math.max(w, h) * (0.28 + envelope * 0.22)
    const burn = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius)
    burn.addColorStop(0, `rgba(255, 250, 220, ${0.42 * envelope})`)
    burn.addColorStop(0.32, `rgba(255, 150, 70, ${0.28 * envelope})`)
    burn.addColorStop(1, 'rgba(255, 105, 35, 0)')
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = burn
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  },
}

const lightLeakBurnDef: TransitionDefinition = {
  id: 'lightLeakBurn',
  label: 'Light Leak Burn',
  description: 'Hot overexposed burn sweep with organic warm bloom',
  category: 'custom',
  icon: 'Flame',
  hasDirection: true,
  directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 26,
  minDuration: 8,
  maxDuration: 90,
  parameters: [
    {
      key: 'intensity',
      label: 'Intensity',
      type: 'number',
      defaultValue: 1.25,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Overall burn strength',
    },
    {
      key: 'spread',
      label: 'Spread',
      type: 'number',
      defaultValue: 1,
      min: 0.2,
      max: 3,
      step: 0.05,
      description: 'Leak bloom width',
    },
    {
      key: 'warmth',
      label: 'Warmth',
      type: 'number',
      defaultValue: 0.75,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Orange heat tint',
    },
    {
      key: 'burn',
      label: 'Burn',
      type: 'number',
      defaultValue: 1.1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Overexposed hotspot',
    },
    {
      key: 'grain',
      label: 'Grain',
      type: 'number',
      defaultValue: 0.5,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Analog grain amount',
    },
  ],
}

// ============================================================================
// Film Gate Slip
// ============================================================================

const filmGateSlipRenderer: TransitionRenderer = {
  gpuTransitionId: 'filmGateSlip',
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = clamp01(progress)
    const envelope = Math.sin(p * Math.PI)
    const y = (isOutgoing ? 1 : -0.55) * (p - 0.5) * envelope * 18
    const x = Math.sin(p * Math.PI * 18) * envelope * 2
    return {
      opacity: fadeOpacity(p, isOutgoing),
      transform: envelope > 0.08 ? `translate(${x}px, ${y}px)` : undefined,
    }
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _direction, canvas) {
    const p = clamp01(progress)
    const w = canvas?.width ?? leftCanvas.width
    const h = canvas?.height ?? leftCanvas.height
    const envelope = Math.sin(p * Math.PI)
    const frame = Math.floor(p * 18)
    const jitter = (seededRandom(frame * 17.3) - 0.5) * envelope
    const slip = (p - 0.5) * envelope * h * 0.08
    const shake = jitter * 8

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, false)
    ctx.drawImage(rightCanvas, -shake * 0.5, -slip * 0.55, w, h)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = fadeOpacity(p, true)
    ctx.drawImage(leftCanvas, shake, slip, w, h)
    ctx.restore()

    if (envelope <= 0.08) return

    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.fillStyle = `rgba(255, 245, 220, ${0.08 * envelope})`
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.14 * envelope})`
    ctx.fillRect(0, 0, w, h * 0.045)
    ctx.fillRect(0, h * 0.955, w, h * 0.045)
    ctx.restore()
  },
}

const filmGateSlipDef: TransitionDefinition = {
  id: 'filmGateSlip',
  label: 'Film Gate Slip',
  description: 'Analog frame slip with exposure flicker and gate-edge flash',
  category: 'custom',
  icon: 'Film',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 22,
  minDuration: 8,
  maxDuration: 72,
  parameters: [
    {
      key: 'slip',
      label: 'Slip',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Vertical frame slip',
    },
    {
      key: 'shake',
      label: 'Shake',
      type: 'number',
      defaultValue: 1,
      min: 0,
      max: 3,
      step: 0.05,
      description: 'Gate jitter amount',
    },
    {
      key: 'exposure',
      label: 'Exposure',
      type: 'number',
      defaultValue: 0.85,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Exposure flicker',
    },
    {
      key: 'gateWidth',
      label: 'Gate Width',
      type: 'number',
      defaultValue: 0.075,
      min: 0,
      max: 0.2,
      step: 0.005,
      description: 'Film gate edge width',
    },
    {
      key: 'grain',
      label: 'Grain',
      type: 'number',
      defaultValue: 0.6,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Film grain amount',
    },
    {
      key: 'chroma',
      label: 'Chroma',
      type: 'number',
      defaultValue: 0.55,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Analog color offset',
    },
    {
      key: 'roll',
      label: 'Roll',
      type: 'number',
      defaultValue: 0.75,
      min: 0,
      max: 2,
      step: 0.05,
      description: 'Rolling frame drift',
    },
  ],
}

// ============================================================================
// Registration
// ============================================================================

export function registerGpuTransitions(registry: TransitionRegistry): void {
  registry.register('dissolve', dissolveDef, dissolveRenderer)
  registry.register('additiveDissolve', additiveDissolveDef, additiveDissolveRenderer)
  registry.register('blurDissolve', blurDissolveDef, blurDissolveRenderer)
  registry.register('dipToColorDissolve', dipToColorDissolveDef, dipToColorDissolveRenderer)
  registry.register('nonAdditiveDissolve', nonAdditiveDissolveDef, nonAdditiveDissolveRenderer)
  registry.register('smoothCut', smoothCutDef, smoothCutRenderer)
  registry.register('sparkles', sparklesDef, sparklesRenderer)
  registry.register('glitch', glitchDef, glitchRenderer)
  registry.register('pixelate', pixelateDef, pixelateRenderer)
  registry.register('chromatic', chromaticDef, chromaticRenderer)
  registry.register('radialBlur', radialBlurDef, radialBlurRenderer)
  registry.register('liquidDistort', liquidDistortDef, liquidDistortRenderer)
  registry.register('lensWarpZoom', lensWarpZoomDef, lensWarpZoomRenderer)
  registry.register('lightLeakBurn', lightLeakBurnDef, lightLeakBurnRenderer)
  registry.register('filmGateSlip', filmGateSlipDef, filmGateSlipRenderer)
}
