/**
 * Cheap dominant-color extractor that turns a scene thumbnail into
 * either a short English phrase ("warm orange, teal, near black")
 * for embedding context, or a structural Lab palette for exact
 * color-query ranking — we run one pass and emit both.
 *
 * Runs in ~5-15 ms per thumbnail on a downsampled 64×64 grid — much
 * cheaper than k-means. Quantizes each pixel into a 4×4×4 RGB bucket
 * (64 bins total), takes the most populated ones, and reports either
 * a label string or the Lab + weight tuple. Lab coordinates use
 * D65 sRGB as the source and are the canonical input for ∆E queries.
 */

import { rgbToLab } from './lab-color'

const SAMPLE_SIZE = 64
const TOP_COLOR_COUNT = 4 // one more than the phrase variant — palette ranking benefits from extra context
const MIN_BIN_FRACTION = 0.04 // ignore colors that cover <4% of the frame

/**
 * Structural entry in a scene's dominant color palette. Stored
 * per-caption and queried at rank time via ∆E 2000 against user
 * color terms.
 */
export interface PaletteEntry {
  /** CIELAB components; `l` ∈ [0, 100], `a`/`b` ≈ [-128, 128]. */
  l: number
  a: number
  b: number
  /** 0–1 fraction of thumbnail pixels assigned to this bin. */
  weight: number
}

interface BinEntry {
  count: number
  rSum: number
  gSum: number
  bSum: number
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const delta = max - min
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    switch (max) {
      case rf:
        h = (gf - bf) / delta + (gf < bf ? 6 : 0)
        break
      case gf:
        h = (bf - rf) / delta + 2
        break
      default:
        h = (rf - gf) / delta + 4
        break
    }
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

function hueLabel(hue: number): string {
  // 8-way hue wheel — generic enough that a query like "orange sky"
  // reliably hits thumbs with warm sunset tones, specific enough that
  // "green" doesn't collapse into "yellow-green".
  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 40) return 'orange'
  if (hue < 65) return 'yellow'
  if (hue < 95) return 'yellow green'
  if (hue < 165) return 'green'
  if (hue < 200) return 'teal'
  if (hue < 255) return 'blue'
  if (hue < 285) return 'purple'
  if (hue < 345) return 'pink'
  return 'red'
}

function colorLabel(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl(r, g, b)
  if (l < 12) return 'near black'
  if (l > 92) return 'near white'
  if (s < 12) {
    if (l < 35) return 'dark gray'
    if (l < 65) return 'gray'
    return 'light gray'
  }
  const hue = hueLabel(h)
  if (l < 25) return `dark ${hue}`
  if (l > 75) return `light ${hue}`
  if (l < 45 && s > 40) return `deep ${hue}`
  if (s > 70 && l > 50 && (hue === 'orange' || hue === 'red' || hue === 'yellow')) {
    return `warm ${hue}`
  }
  return hue
}

interface ExtractedColors {
  /** Human-readable phrase for the embedding input. */
  phrase: string
  /** Lab+weight entries ranked by coverage, ready to ∆E against. */
  palette: PaletteEntry[]
}

/**
 * One-pass dominant-color extraction. Returns both the labeled
 * phrase (for the transformer-visible COLORS: line) and the
 * structural Lab palette (for ∆E color-query ranking).
 */
export async function extractDominantColors(blob: Blob): Promise<ExtractedColors> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return { phrase: '', palette: [] }
  }
  try {
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE)
    const context = canvas.getContext('2d')
    if (!context) return { phrase: '', palette: [] }
    context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    const bins = new Map<number, BinEntry>()
    const totalPixels = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)
      const bin = bins.get(key)
      if (bin) {
        bin.count += 1
        bin.rSum += r
        bin.gSum += g
        bin.bSum += b
      } else {
        bins.set(key, { count: 1, rSum: r, gSum: g, bSum: b })
      }
    }

    const ranked = [...bins.values()]
      .filter((bin) => bin.count / totalPixels >= MIN_BIN_FRACTION)
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_COLOR_COUNT)

    const labels: string[] = []
    const seenLabels = new Set<string>()
    const palette: PaletteEntry[] = []

    for (const bin of ranked) {
      const r = Math.round(bin.rSum / bin.count)
      const g = Math.round(bin.gSum / bin.count)
      const b = Math.round(bin.bSum / bin.count)

      const label = colorLabel(r, g, b)
      if (!seenLabels.has(label)) {
        seenLabels.add(label)
        labels.push(label)
      }

      const lab = rgbToLab(r, g, b)
      palette.push({
        l: Number(lab.l.toFixed(2)),
        a: Number(lab.a.toFixed(2)),
        b: Number(lab.b.toFixed(2)),
        weight: Number((bin.count / totalPixels).toFixed(3)),
      })
    }

    return { phrase: labels.join(', '), palette }
  } finally {
    bitmap.close()
  }
}

/**
 * Back-compat helper for code paths that only need the human phrase
 * (embedding input). Equivalent to `extractDominantColors().phrase`.
 */
export async function extractDominantColorPhrase(blob: Blob): Promise<string> {
  return (await extractDominantColors(blob)).phrase
}
