/**
 * Sample A/B stills for transition previews.
 *
 * Two contrasting bundled images (warm sunset vs. cool night sea) are decoded
 * once into offscreen canvases sized to the preview, then fed as the outgoing
 * (A) and incoming (B) frames to a renderer's `renderCanvas()`. Like an NLE
 * picker, the contrast makes wipes/dissolves/slides actually read.
 *
 * Swap these SVGs for real photos (or wire in live timeline frames) without
 * touching the preview component — this module is the only A/B source.
 */

import frameAUrl from './frame-a.svg'
import frameBUrl from './frame-b.svg'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('TransitionPreviewFrames')

/** Backing-store size of the preview frames (16:9). CSS scales the canvas down. */
export const PREVIEW_WIDTH = 160
export const PREVIEW_HEIGHT = 90

export interface SampleFrames {
  a: OffscreenCanvas
  b: OffscreenCanvas
}

let cache: Promise<SampleFrames | null> | null = null

async function loadFrame(url: string): Promise<OffscreenCanvas> {
  const img = new Image()
  img.src = url
  await img.decode()
  const oc = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  const ctx = oc.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable for sample frame')
  ctx.drawImage(img, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  return oc
}

/**
 * Decode the A/B sample frames once and cache the promise. Resolves to `null`
 * when OffscreenCanvas is unavailable or decode fails — callers fall back to
 * the static icon.
 */
export function getSampleFrames(): Promise<SampleFrames | null> {
  if (cache) return cache
  cache = (async () => {
    if (typeof OffscreenCanvas === 'undefined') return null
    try {
      const [a, b] = await Promise.all([loadFrame(frameAUrl), loadFrame(frameBUrl)])
      return { a, b }
    } catch (error) {
      log.warn('Failed to decode transition preview frames', { error: String(error) })
      return null
    }
  })()
  return cache
}
