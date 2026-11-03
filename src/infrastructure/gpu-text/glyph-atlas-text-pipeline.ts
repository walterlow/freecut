import type { TextItem } from '@/types/timeline'
import type { TextMotionSpec } from '@/types/text-motion'
import { layoutTextBlock, lineInkWidth } from '@/shared/typography/text-block-layout'
import { parseFontSizePx, type TextMeasurer } from '@/shared/typography/text-measurer'
import {
  evaluateGlyphMotion,
  getActiveTextMotionSlot,
  getTextMotionPreset,
  segmentTextUnits,
  type GlyphMotionState,
  type TextUnitSegmentation,
} from '@/shared/typography/text-motion'

export interface GpuTextRenderParams {
  outputWidth: number
  outputHeight: number
  item: TextItem
  width: number
  height: number
  /**
   * Motion text (per-unit text animation). When present, glyphs are packed
   * with per-glyph motion states evaluated for this frame; when absent the
   * render path does zero extra work. See
   * docs/plans/2026-07-03-001-feat-motion-text-plan.md.
   */
  motion?: {
    spec: TextMotionSpec
    /** Frame relative to the item start, in project-fps frames. */
    relativeFrame: number
    fps: number
    durationInFrames: number
  }
}

type GlyphKey = string

interface GlyphMetrics {
  key: GlyphKey
  char: string
  font: string
  atlasX: number
  atlasY: number
  atlasWidth: number
  atlasHeight: number
  contentWidth: number
  contentHeight: number
  offsetX: number
  offsetY: number
  advance: number
}

interface PackedGlyph {
  metrics: GlyphMetrics
  x: number
  y: number
  width: number
  height: number
  color: [number, number, number, number]
  strokeColor?: [number, number, number, number]
  strokeWidth?: number
  solidRadius?: number
  shadowBlur?: number
  /** Per-glyph motion-text state; absent = identity (no motion). */
  motion?: GlyphMotionState
}

const ATLAS_SIZE = 2048
const GLYPH_PADDING = 12
const GLYPH_SDF_RADIUS = 8
const FLOATS_PER_VERTEX = 20
const VERTICES_PER_GLYPH = 6
const MAX_GLYPHS_PER_RENDER = 4096
const SOLID_GLYPH_KEY = '__solid__'

const TEXT_SHADER = /* wgsl */ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) atlasUv: vec2f,
  @location(2) color: vec4f,
  @location(3) solidMode: f32,
  @location(4) solidRect: vec4f,
  @location(5) solidRadius: f32,
  @location(6) strokeColor: vec4f,
  @location(7) strokeWidth: f32,
  @location(8) shadowBlur: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) atlasUv: vec2f,
  @location(1) color: vec4f,
  @location(2) pixel: vec2f,
  @location(3) solidMode: f32,
  @location(4) solidRect: vec4f,
  @location(5) solidRadius: f32,
  @location(6) strokeColor: vec4f,
  @location(7) strokeWidth: f32,
  @location(8) shadowBlur: f32,
};

struct TextUniforms {
  outputSize: vec2f,
  atlasSize: vec2f,
};

@group(0) @binding(0) var atlasSampler: sampler;
@group(0) @binding(1) var atlasTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: TextUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let clip = vec2f(
    input.position.x / u.outputSize.x * 2.0 - 1.0,
    1.0 - input.position.y / u.outputSize.y * 2.0
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.atlasUv = input.atlasUv;
  output.color = input.color;
  output.pixel = input.position;
  output.solidMode = input.solidMode;
  output.solidRect = input.solidRect;
  output.solidRadius = input.solidRadius;
  output.strokeColor = input.strokeColor;
  output.strokeWidth = input.strokeWidth;
  output.shadowBlur = input.shadowBlur;
  return output;
}

fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let radius = min(r, min(b.x, b.y));
  let q = abs(p) - max(b - vec2f(radius), vec2f(0.0));
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let distanceAlpha = textureSample(atlasTex, atlasSampler, input.atlasUv).a;
  let halfSize = input.solidRect.zw * 0.5;
  let center = input.solidRect.xy + halfSize;
  let rectDistance = sdRoundedBox(input.pixel - center, halfSize, input.solidRadius);
  let solidAlpha = 1.0 - smoothstep(-0.75, 0.75, rectDistance);
  let blurBand = input.shadowBlur / 32.0;
  let glyphEdgeMin = 0.48 - blurBand;
  let glyphEdgeMax = 0.54 + blurBand;
  let fillAlpha = smoothstep(glyphEdgeMin, glyphEdgeMax, distanceAlpha) * input.color.a;
  let strokeBand = clamp(input.strokeWidth / 16.0, 0.0, 0.49);
  let strokeAlpha = smoothstep(0.5 - strokeBand - 0.04, 0.5 - strokeBand + 0.04, distanceAlpha) * input.strokeColor.a;
  let glyphAlpha = fillAlpha + strokeAlpha * (1.0 - fillAlpha);
  let glyphRgb = mix(input.strokeColor.rgb, input.color.rgb, select(0.0, fillAlpha / max(glyphAlpha, 0.0001), glyphAlpha > 0.0));
  let alpha = mix(glyphAlpha, solidAlpha * input.color.a, input.solidMode);
  let rgb = mix(glyphRgb, input.color.rgb, input.solidMode);
  return vec4f(rgb, alpha);
}
`

export class GlyphAtlasTextPipeline {
  private readonly atlasTexture: GPUTexture
  private readonly sampler: GPUSampler
  private readonly uniformBuffer: GPUBuffer
  private readonly vertexBuffer: GPUBuffer
  private readonly bindGroup: GPUBindGroup
  private readonly pipeline: GPURenderPipeline
  private readonly glyphs = new Map<GlyphKey, GlyphMetrics>()
  private readonly scratchCanvas: OffscreenCanvas
  private readonly scratchCtx: OffscreenCanvasRenderingContext2D
  private nextX = 0
  private nextY = 0
  private rowHeight = 0
  private atlasExhausted = false

  constructor(private readonly device: GPUDevice) {
    const scratchCanvas = new OffscreenCanvas(1, 1)
    const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true })
    if (!scratchCtx) throw new Error('Unable to create glyph atlas canvas context')
    this.scratchCanvas = scratchCanvas
    this.scratchCtx = scratchCtx

    this.atlasTexture = device.createTexture({
      label: 'glyph-atlas-texture',
      size: { width: ATLAS_SIZE, height: ATLAS_SIZE },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.uniformBuffer = device.createBuffer({
      label: 'glyph-atlas-text-uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.vertexBuffer = device.createBuffer({
      label: 'glyph-atlas-text-vertices',
      size: MAX_GLYPHS_PER_RENDER * VERTICES_PER_GLYPH * FLOATS_PER_VERTEX * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })

    const shaderModule = device.createShaderModule({ label: 'glyph-atlas-text', code: TEXT_SHADER })
    const bindGroupLayout = device.createBindGroupLayout({
      label: 'glyph-atlas-text-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    })
    this.bindGroup = device.createBindGroup({
      label: 'glyph-atlas-text-bind-group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.atlasTexture.createView() },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    })
    this.pipeline = device.createRenderPipeline({
      label: 'glyph-atlas-text-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: FLOATS_PER_VERTEX * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
              { shaderLocation: 4, offset: 36, format: 'float32x4' },
              { shaderLocation: 5, offset: 52, format: 'float32' },
              { shaderLocation: 6, offset: 56, format: 'float32x4' },
              { shaderLocation: 7, offset: 72, format: 'float32' },
              { shaderLocation: 8, offset: 76, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  renderTextToTexture(outputTexture: GPUTexture, params: GpuTextRenderParams): boolean {
    if (
      outputTexture.width !== params.outputWidth ||
      outputTexture.height !== params.outputHeight
    ) {
      return false
    }
    let layout = this.layoutText(params.item, params.width, params.height, params.motion)
    if (!layout && this.atlasExhausted) {
      this.resetAtlas()
      layout = this.layoutText(params.item, params.width, params.height, params.motion)
    }
    if (!layout) return false
    if (layout.glyphs.length === 0) return this.clearTexture(outputTexture)
    if (layout.glyphs.length > MAX_GLYPHS_PER_RENDER) return false

    const vertexData = new Float32Array(
      layout.glyphs.length * VERTICES_PER_GLYPH * FLOATS_PER_VERTEX,
    )
    let offset = 0
    for (const glyph of layout.glyphs) {
      offset = writeGlyphVertices(vertexData, offset, glyph)
    }
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData, 0, offset)
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([params.outputWidth, params.outputHeight, ATLAS_SIZE, ATLAS_SIZE]),
    )

    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: outputTexture.createView(), loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.setVertexBuffer(0, this.vertexBuffer)
    pass.draw(layout.glyphs.length * VERTICES_PER_GLYPH)
    pass.end()
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  destroy(): void {
    this.atlasTexture.destroy()
    this.uniformBuffer.destroy()
    this.vertexBuffer.destroy()
  }

  private clearTexture(outputTexture: GPUTexture): boolean {
    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: outputTexture.createView(), loadOp: 'clear', storeOp: 'store' }],
    })
    pass.end()
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  private layoutText(
    item: TextItem,
    width: number,
    height: number,
    motion?: GpuTextRenderParams['motion'],
  ): { glyphs: PackedGlyph[] } | null {
    const measurer = this.createMeasurer()
    const layout = layoutTextBlock(item, width, height, measurer)

    // Motion text: resolve the active slot ONCE per render and segment the
    // laid-out lines by that slot's unit (different slots can use different
    // units — char vs word vs line). Everything is guarded behind `motion`
    // so motion-less renders do zero extra work.
    let motionSegmentation: TextUnitSegmentation | null = null
    if (motion) {
      const slot = getActiveTextMotionSlot(
        motion.spec,
        motion.relativeFrame,
        motion.durationInFrames,
      )
      const effect = slot ? motion.spec[slot] : undefined
      if (effect) {
        motionSegmentation = segmentTextUnits(
          layout.lines.map((line) => line.text),
          effect.unit ?? getTextMotionPreset(effect.presetId).unit,
        )
      }
    }
    const evaluateMotion = (
      unitIndex: number | null,
      fontSize: number,
    ): GlyphMotionState | undefined => {
      if (!motion || !motionSegmentation || unitIndex === null) return undefined
      return (
        evaluateGlyphMotion(motion.spec, {
          relativeFrame: motion.relativeFrame,
          fps: motion.fps,
          durationInFrames: motion.durationInFrames,
          unitIndex,
          unitCount: motionSegmentation.unitCount,
          fontSize,
          boxWidth: width,
          boxHeight: height,
        }) ?? undefined
      )
    }

    const glyphs: PackedGlyph[] = []
    if (item.backgroundColor && layout.background) {
      const backgroundColor = parseGpuTextColor(item.backgroundColor)
      const backgroundGlyph = this.ensureSolidGlyph()
      if (!backgroundColor || !backgroundGlyph) return null
      const bg = layout.background
      glyphs.push({
        metrics: backgroundGlyph,
        x: bg.x,
        y: bg.y,
        width: bg.width,
        height: bg.height,
        color: backgroundColor,
        solidRadius: bg.radius,
      })
    }

    const shadow = item.textShadow
    const shadowColor = shadow ? parseGpuTextColor(shadow.color) : undefined
    if (shadow && !shadowColor) return null
    const strokeWidth = Math.max(0, item.stroke?.width ?? 0)
    let strokeColor: [number, number, number, number] | undefined
    if (strokeWidth > 0) {
      const parsedStrokeColor = parseGpuTextColor(item.stroke?.color ?? '#000000')
      if (!parsedStrokeColor) return null
      strokeColor = parsedStrokeColor
    }

    for (const [lineIndex, line] of layout.lines.entries()) {
      const color = parseGpuTextColor(line.color)
      if (!color) return null
      // Inline span flow: per-glyph color follows the run covering that char.
      const runColorByChar = line.runs?.flatMap((run) => {
        const parsed = parseGpuTextColor(run.color) ?? color
        return Array.from(run.text, () => parsed)
      })
      const lineUnits = motionSegmentation?.lineUnitIndices[lineIndex]
      const baselineY = line.baselineY
      let prefix = ''
      let charIndex = 0
      for (const char of line.text) {
        const metrics = this.ensureGlyph(char, line.cssFont, line.fontSize)
        if (!metrics) return null
        prefix += char
        // Match the kerning used by the DOM and settled canvas text.
        const currentX =
          line.startX +
          measurer.measure(prefix, line.cssFont, 0) -
          metrics.advance +
          charIndex * line.letterSpacing
        if (char !== ' ') {
          // `lineUnits` is parallel to the line's code points — exactly what
          // this `for (const char of ...)` walk iterates.
          const glyphMotion = motionSegmentation
            ? evaluateMotion(lineUnits?.[charIndex] ?? null, line.fontSize)
            : undefined
          // Fully hidden glyphs (typewriter pre-reveal) emit nothing —
          // including the shadow twin — so the vertex write count always
          // matches the packed glyph count that gets drawn.
          if (!glyphMotion || glyphMotion.alpha > 0) {
            if (shadow && shadowColor) {
              // The shadow twin follows its parent glyph's motion; its alpha
              // is multiplied by the motion alpha in writeGlyphVertices.
              glyphs.push({
                metrics,
                x: currentX + metrics.offsetX + shadow.offsetX,
                y: baselineY + metrics.offsetY + shadow.offsetY,
                width: metrics.contentWidth,
                height: metrics.contentHeight,
                color: shadowColor,
                shadowBlur: Math.max(0, shadow.blur),
                motion: glyphMotion,
              })
            }
            glyphs.push({
              metrics,
              x: currentX + metrics.offsetX,
              y: baselineY + metrics.offsetY,
              width: metrics.contentWidth,
              height: metrics.contentHeight,
              color: runColorByChar?.[charIndex] ?? color,
              strokeColor,
              strokeWidth,
              motion: glyphMotion,
            })
          }
        }
        charIndex++
      }
      const underlineWidth = lineInkWidth(line)
      if (line.underline && underlineWidth > 0) {
        const underlineGlyph = this.ensureSolidGlyph()
        if (!underlineGlyph) return null
        // Underline segments take their line's unit. Under the active
        // segmentation the line's representative unit index is its FIRST
        // non-null entry: for the 'line' unit that IS the line's index; for
        // char/word units the line's first unit stands in for the whole
        // segment (the underline spans the line, so a single whole-line
        // evaluation is the only coherent choice).
        let underlineMotion: GlyphMotionState | undefined
        if (motionSegmentation) {
          const representative = lineUnits?.find((unit) => unit !== null) ?? null
          const state = evaluateMotion(representative, line.fontSize)
          // Solid quads render through an axis-aligned rect SDF in the
          // fragment shader — rotation cannot be represented there, so the
          // underline follows every motion channel except rotation.
          if (state) underlineMotion = state.rotation === 0 ? state : { ...state, rotation: 0 }
        }
        if (!underlineMotion || underlineMotion.alpha > 0) {
          const underlineY = baselineY + Math.max(1, line.fontSize * 0.08)
          const underlineHeight = Math.max(1, line.fontSize * 0.05)
          if (shadow && shadowColor) {
            glyphs.push({
              metrics: underlineGlyph,
              x: line.startX + shadow.offsetX,
              y: underlineY + shadow.offsetY,
              width: underlineWidth,
              height: underlineHeight,
              color: shadowColor,
              solidRadius: 0,
              motion: underlineMotion,
            })
          }
          glyphs.push({
            metrics: underlineGlyph,
            x: line.startX,
            y: underlineY,
            width: underlineWidth,
            height: underlineHeight,
            color,
            solidRadius: 0,
            motion: underlineMotion,
          })
        }
      }
      // Inline span flow: per-run underlines (line.underline is false there).
      for (const run of line.runs ?? []) {
        if (!run.underline) continue
        const runInkWidth = Math.max(0, run.width - line.letterSpacing)
        if (runInkWidth <= 0) continue
        const underlineGlyph = this.ensureSolidGlyph()
        if (!underlineGlyph) return null
        const runColor = parseGpuTextColor(run.color) ?? color
        glyphs.push({
          metrics: underlineGlyph,
          x: line.startX + run.offsetX,
          y: baselineY + Math.max(1, line.fontSize * 0.08),
          width: runInkWidth,
          height: Math.max(1, line.fontSize * 0.05),
          color: runColor,
          solidRadius: 0,
          motion: undefined,
        })
      }
    }
    return { glyphs }
  }

  /**
   * Measure complete strings so wrapping and alignment preserve kerning, just
   * like the canvas/DOM paths. Add trailing letter-spacing (CSS semantics).
   */
  private createMeasurer(): TextMeasurer {
    return {
      measure: (text, cssFont, letterSpacing) => {
        this.scratchCtx.font = cssFont
        this.scratchCtx.fontKerning = 'normal'
        this.scratchCtx.letterSpacing = '0px'
        return this.scratchCtx.measureText(text).width + text.length * letterSpacing
      },
      fontMetrics: (cssFont) => this.measureFont(cssFont, parseFontSizePx(cssFont)),
    }
  }

  private measureFont(font: string, fontSize: number): { ascent: number; descent: number } {
    this.scratchCtx.font = font
    const metrics = this.scratchCtx.measureText('Hg')
    const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8
    const descent = metrics.fontBoundingBoxDescent || fontSize * 0.2
    return { ascent, descent }
  }

  private ensureGlyph(char: string, font: string, fontSize: number): GlyphMetrics | null {
    const key = `${font}\n${char}`
    const cached = this.glyphs.get(key)
    if (cached) return cached

    this.scratchCtx.font = font
    this.scratchCtx.fontKerning = 'normal'
    this.scratchCtx.letterSpacing = '0px'
    this.scratchCtx.textBaseline = 'alphabetic'
    const measured = this.scratchCtx.measureText(char)
    const ascent =
      measured.actualBoundingBoxAscent || measured.fontBoundingBoxAscent || fontSize * 0.8
    const descent =
      measured.actualBoundingBoxDescent || measured.fontBoundingBoxDescent || fontSize * 0.2
    const left = measured.actualBoundingBoxLeft || 0
    const right = measured.actualBoundingBoxRight || measured.width
    const contentWidth = Math.max(1, Math.ceil(left + right))
    const contentHeight = Math.max(1, Math.ceil(ascent + descent))
    const glyphWidth = contentWidth + GLYPH_PADDING * 2
    const glyphHeight = contentHeight + GLYPH_PADDING * 2
    const atlasPos = this.allocateGlyph(glyphWidth, glyphHeight)
    if (!atlasPos) return null

    this.scratchCanvas.width = glyphWidth
    this.scratchCanvas.height = glyphHeight
    this.scratchCtx.clearRect(0, 0, glyphWidth, glyphHeight)
    this.scratchCtx.font = font
    this.scratchCtx.textBaseline = 'alphabetic'
    this.scratchCtx.fillStyle = '#ffffff'
    this.scratchCtx.fillText(char, GLYPH_PADDING + left, GLYPH_PADDING + ascent)
    const image = this.scratchCtx.getImageData(0, 0, glyphWidth, glyphHeight)
    const sdf = buildGlyphSdf(image.data, glyphWidth, glyphHeight)
    this.uploadGlyph(atlasPos.x, atlasPos.y, glyphWidth, glyphHeight, sdf)

    const metrics: GlyphMetrics = {
      key,
      char,
      font,
      atlasX: atlasPos.x,
      atlasY: atlasPos.y,
      atlasWidth: glyphWidth,
      atlasHeight: glyphHeight,
      contentWidth: glyphWidth,
      contentHeight: glyphHeight,
      offsetX: -GLYPH_PADDING - left,
      offsetY: -GLYPH_PADDING - ascent,
      advance: measured.width,
    }
    this.glyphs.set(key, metrics)
    return metrics
  }

  private ensureSolidGlyph(): GlyphMetrics | null {
    const cached = this.glyphs.get(SOLID_GLYPH_KEY)
    if (cached) return cached
    const atlasPos = this.allocateGlyph(1, 1)
    if (!atlasPos) return null
    this.uploadGlyph(atlasPos.x, atlasPos.y, 1, 1, new Uint8Array([255, 255, 255, 255]))
    const metrics: GlyphMetrics = {
      key: SOLID_GLYPH_KEY,
      char: '',
      font: '',
      atlasX: atlasPos.x,
      atlasY: atlasPos.y,
      atlasWidth: 1,
      atlasHeight: 1,
      contentWidth: 1,
      contentHeight: 1,
      offsetX: 0,
      offsetY: 0,
      advance: 0,
    }
    this.glyphs.set(SOLID_GLYPH_KEY, metrics)
    return metrics
  }

  private allocateGlyph(width: number, height: number): { x: number; y: number } | null {
    if (width > ATLAS_SIZE || height > ATLAS_SIZE) return null
    if (this.nextX + width > ATLAS_SIZE) {
      this.nextX = 0
      this.nextY += this.rowHeight
      this.rowHeight = 0
    }
    if (this.nextY + height > ATLAS_SIZE) {
      this.atlasExhausted = true
      return null
    }
    const position = { x: this.nextX, y: this.nextY }
    this.nextX += width
    this.rowHeight = Math.max(this.rowHeight, height)
    return position
  }

  private resetAtlas(): void {
    this.glyphs.clear()
    this.nextX = 0
    this.nextY = 0
    this.rowHeight = 0
    this.atlasExhausted = false
  }

  private uploadGlyph(x: number, y: number, width: number, height: number, rgba: Uint8Array): void {
    const bytesPerRow = alignTo(width * 4, 256)
    const padded = new Uint8Array(bytesPerRow * height)
    for (let row = 0; row < height; row++) {
      padded.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), row * bytesPerRow)
    }
    this.device.queue.writeTexture(
      { texture: this.atlasTexture, origin: { x, y } },
      padded,
      { bytesPerRow, rowsPerImage: height },
      { width, height },
    )
  }
}

/**
 * Transform the four corners of a glyph quad (TL, TR, BL, BR order) by a
 * motion state: uniform scale and rotation about the quad center, then dx/dy
 * translation. All motion is baked into vertex positions CPU-side — the
 * atlas UVs stay attached to their corners (UVs interpolate per vertex), so
 * rotated quads sample the same axis-aligned atlas rect and the vertex
 * format/stride is unchanged. Exported for unit tests.
 */
export function transformGlyphQuadCorners(
  x: number,
  y: number,
  width: number,
  height: number,
  motion: Pick<GlyphMotionState, 'dx' | 'dy' | 'scale' | 'rotation'>,
): [[number, number], [number, number], [number, number], [number, number]] {
  const cx = x + width / 2
  const cy = y + height / 2
  const cos = Math.cos(motion.rotation)
  const sin = Math.sin(motion.rotation)
  const transform = (px: number, py: number): [number, number] => {
    const lx = (px - cx) * motion.scale
    const ly = (py - cy) * motion.scale
    return [cx + lx * cos - ly * sin + motion.dx, cy + lx * sin + ly * cos + motion.dy]
  }
  return [
    transform(x, y),
    transform(x + width, y),
    transform(x, y + height),
    transform(x + width, y + height),
  ]
}

function writeGlyphVertices(data: Float32Array, offset: number, glyph: PackedGlyph): number {
  const { metrics, color, motion } = glyph
  const x0 = glyph.x
  const y0 = glyph.y
  const x1 = glyph.x + glyph.width
  const y1 = glyph.y + glyph.height
  const u0 = metrics.atlasX / ATLAS_SIZE
  const v0 = metrics.atlasY / ATLAS_SIZE
  const u1 = (metrics.atlasX + metrics.atlasWidth) / ATLAS_SIZE
  const v1 = (metrics.atlasY + metrics.atlasHeight) / ATLAS_SIZE
  const [tl, tr, bl, br] = motion
    ? transformGlyphQuadCorners(x0, y0, glyph.width, glyph.height, motion)
    : ([
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ] as [[number, number], [number, number], [number, number], [number, number]])
  const vertices = [
    [tl[0], tl[1], u0, v0],
    [tr[0], tr[1], u1, v0],
    [bl[0], bl[1], u0, v1],
    [bl[0], bl[1], u0, v1],
    [tr[0], tr[1], u1, v0],
    [br[0], br[1], u1, v1],
  ]
  const solidMode = glyph.solidRadius === undefined ? 0 : 1
  const solidRadius = glyph.solidRadius ?? 0
  const strokeColor: [number, number, number, number] = glyph.strokeColor ?? [0, 0, 0, 0]
  const strokeWidth = glyph.strokeWidth ?? 0
  // Motion `soften` rides the existing SDF edge-widening band additively —
  // the fill glyph's own shadowBlur is normally 0, so soften just widens the
  // smoothstep edge (a free blur-in); shadow twins widen on top of their blur.
  const shadowBlur = (glyph.shadowBlur ?? 0) + (motion?.soften ?? 0)
  // Motion alpha multiplies the fill alpha and, when present, the stroke
  // alpha (shadow twins carry it in `color`, so they fade with the glyph).
  const colorAlpha = motion ? color[3] * motion.alpha : color[3]
  const strokeAlpha = motion ? strokeColor[3] * motion.alpha : strokeColor[3]
  // Solid quads (underline) evaluate an axis-aligned rect SDF in pixel space;
  // bake scale-about-center + translation into the rect so it tracks the quad
  // (rotation is stripped for solids at pack time).
  let solidX = x0
  let solidY = y0
  let solidW = glyph.width
  let solidH = glyph.height
  if (motion) {
    solidW = glyph.width * motion.scale
    solidH = glyph.height * motion.scale
    solidX = x0 + (glyph.width - solidW) / 2 + motion.dx
    solidY = y0 + (glyph.height - solidH) / 2 + motion.dy
  }
  for (const vertex of vertices) {
    data[offset++] = vertex[0] ?? 0
    data[offset++] = vertex[1] ?? 0
    data[offset++] = vertex[2] ?? 0
    data[offset++] = vertex[3] ?? 0
    data[offset++] = color[0]
    data[offset++] = color[1]
    data[offset++] = color[2]
    data[offset++] = colorAlpha
    data[offset++] = solidMode
    data[offset++] = solidX
    data[offset++] = solidY
    data[offset++] = solidW
    data[offset++] = solidH
    data[offset++] = solidRadius
    data[offset++] = strokeColor[0]
    data[offset++] = strokeColor[1]
    data[offset++] = strokeColor[2]
    data[offset++] = strokeAlpha
    data[offset++] = strokeWidth
    data[offset++] = shadowBlur
  }
  return offset
}

function buildGlyphSdf(source: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = source[i * 4 + 3] ?? 0
  const output = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const inside = alpha[index]! > 127
      let nearest = GLYPH_SDF_RADIUS
      for (let dy = -GLYPH_SDF_RADIUS; dy <= GLYPH_SDF_RADIUS; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -GLYPH_SDF_RADIUS; dx <= GLYPH_SDF_RADIUS; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const otherInside = alpha[yy * width + xx]! > 127
          if (otherInside === inside) continue
          nearest = Math.min(nearest, Math.hypot(dx, dy))
        }
      }
      const signed = inside ? nearest : -nearest
      const value = Math.max(
        0,
        Math.min(255, Math.round((0.5 + signed / (GLYPH_SDF_RADIUS * 2)) * 255)),
      )
      const out = index * 4
      output[out] = 255
      output[out + 1] = 255
      output[out + 2] = 255
      output[out + 3] = value
    }
  }
  return output
}

function parseGpuTextColor(color: string): [number, number, number, number] | null {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const chars = hex.split('')
      const r = parseInt(`${chars[0]}${chars[0]}`, 16)
      const g = parseInt(`${chars[1]}${chars[1]}`, 16)
      const b = parseInt(`${chars[2]}${chars[2]}`, 16)
      const a = chars[3] ? parseInt(`${chars[3]}${chars[3]}`, 16) : 255
      return [r / 255, g / 255, b / 255, a / 255]
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255
      return [r / 255, g / 255, b / 255, a / 255]
    }
  }
  return null
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}
