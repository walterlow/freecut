import type React from 'react'
import type { CropSettings } from '@/types/transform'
import { calculateMediaCropLayout, type MediaCropLayout } from '@/shared/utils/media-crop'

interface ContainedMediaLayoutProps {
  sourceWidth: number
  sourceHeight: number
  containerWidth: number
  containerHeight: number
  crop?: CropSettings
  children: React.ReactNode
}

function percent(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return '0%'
  }
  return `${(value / total) * 100}%`
}

/**
 * Build a single composite CSS mask-image that handles both hard crop edges
 * and soft feather in one shot. Each cropped edge gets a gradient layer;
 * layers are intersected so all edges apply simultaneously.
 *
 * Returns undefined when no crop is active (no mask needed).
 */
function buildCropMask(layout: MediaCropLayout): string | undefined {
  const { mediaRect, viewportRect, featherPixels, crop } = layout
  const hasCrop = crop.left > 0 || crop.right > 0 || crop.top > 0 || crop.bottom > 0
  if (!hasCrop) return undefined

  const mw = mediaRect.width
  const mh = mediaRect.height
  if (mw <= 0 || mh <= 0) return undefined

  // Viewport edges in media-relative percentages
  const vpLeft = ((viewportRect.x - mediaRect.x) / mw) * 100
  const vpRight = ((viewportRect.x - mediaRect.x + viewportRect.width) / mw) * 100
  const vpTop = ((viewportRect.y - mediaRect.y) / mh) * 100
  const vpBottom = ((viewportRect.y - mediaRect.y + viewportRect.height) / mh) * 100

  // Feather in media-relative percentages
  const fl = mw > 0 ? (featherPixels.left / mw) * 100 : 0
  const fr = mw > 0 ? (featherPixels.right / mw) * 100 : 0
  const ft = mh > 0 ? (featherPixels.top / mh) * 100 : 0
  const fb = mh > 0 ? (featherPixels.bottom / mh) * 100 : 0

  const layers: string[] = []

  // Each cropped edge gets a gradient: transparent outside, opaque inside,
  // with optional feather ramp at the boundary.
  if (crop.left > 0) {
    const opaqueStart = vpLeft + fl
    layers.push(`linear-gradient(90deg, transparent ${vpLeft}%, black ${opaqueStart}%, black 100%)`)
  }
  if (crop.right > 0) {
    const opaqueEnd = vpRight - fr
    layers.push(`linear-gradient(90deg, black 0%, black ${opaqueEnd}%, transparent ${vpRight}%)`)
  }
  if (crop.top > 0) {
    const opaqueStart = vpTop + ft
    layers.push(`linear-gradient(180deg, transparent ${vpTop}%, black ${opaqueStart}%, black 100%)`)
  }
  if (crop.bottom > 0) {
    const opaqueEnd = vpBottom - fb
    layers.push(`linear-gradient(180deg, black 0%, black ${opaqueEnd}%, transparent ${vpBottom}%)`)
  }

  if (layers.length === 0) return undefined
  return layers.join(', ')
}

/**
 * Explicit contain-fit wrapper for media content.
 * This makes media framing deterministic so crop preview and export use the same geometry.
 */
export function ContainedMediaLayout({
  sourceWidth,
  sourceHeight,
  containerWidth,
  containerHeight,
  crop,
  children,
}: ContainedMediaLayoutProps) {
  const layout = calculateMediaCropLayout(
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
    crop,
  )

  if (layout.mediaRect.width <= 0 || layout.mediaRect.height <= 0) {
    return <div style={{ position: 'relative', width: '100%', height: '100%' }} />
  }

  // Single composite mask handles both hard crop and soft feather.
  // No intermediate viewport div with overflow:hidden — eliminates sub-pixel
  // seams from CSS percentage rounding entirely.
  const maskImage = buildCropMask(layout)
  const maskComposite = maskImage?.includes(', ') ? 'intersect' : undefined

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          left: percent(layout.mediaRect.x, containerWidth),
          top: percent(layout.mediaRect.y, containerHeight),
          width: percent(layout.mediaRect.width, containerWidth),
          height: percent(layout.mediaRect.height, containerHeight),
          maskImage,
          WebkitMaskImage: maskImage,
          ...(maskComposite
            ? {
                maskComposite,
                WebkitMaskComposite: 'destination-in',
              }
            : {}),
        }}
      >
        {children}
      </div>
    </div>
  )
}
