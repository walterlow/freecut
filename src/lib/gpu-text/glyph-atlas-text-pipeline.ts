import type { TextItem } from '@/types/timeline'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'
import { getTextItemSpans } from '@/shared/utils/text-item-spans'

export interface GpuTextRenderParams {
  outputWidth: number
  outputHeight: number
  item: TextItem
  width: number
  height: number
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
}

interface TextLayoutLine {
  text: string
  font: string
  fontSize: number
  lineHeightPx: number
  baselineOffset: number
  letterSpacing: number
  color: [number, number, number, number]
  strokeColor?: [number, number, number, number]
  strokeWidth: number
  underline: boolean
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
    let layout = this.layoutText(params.item, params.width, params.height)
    if (!layout && this.atlasExhausted) {
      this.resetAtlas()
      layout = this.layoutText(params.item, params.width, params.height)
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
  ): { glyphs: PackedGlyph[] } | null {
    const padding = Math.max(0, item.textPadding ?? 16)
    const availableWidth = Math.max(1, width - padding * 2)
    const lines = this.layoutLines(item, availableWidth)
    if (!lines) return null
    const totalHeight = lines.reduce((sum, line) => sum + line.lineHeightPx, 0)
    const availableHeight = height - padding * 2
    const verticalAlign = item.verticalAlign ?? 'middle'
    let currentTop =
      verticalAlign === 'top'
        ? padding
        : verticalAlign === 'bottom'
          ? height - padding - totalHeight
          : padding + (availableHeight - totalHeight) / 2

    const glyphs: PackedGlyph[] = []
    if (item.backgroundColor) {
      const backgroundColor = parseGpuTextColor(item.backgroundColor)
      const backgroundGlyph = this.ensureSolidGlyph()
      if (!backgroundColor || !backgroundGlyph) return null
      glyphs.push({
        metrics: backgroundGlyph,
        x: 0,
        y: 0,
        width,
        height,
        color: backgroundColor,
        solidRadius: Math.max(0, Math.min(item.backgroundRadius ?? 0, width / 2, height / 2)),
      })
    }

    for (const line of lines) {
      const lineWidth = this.measureText(line.text, line.font, line.letterSpacing)
      const textAlign = item.textAlign ?? 'center'
      let currentX =
        textAlign === 'left'
          ? padding
          : textAlign === 'right'
            ? width - padding - lineWidth
            : (width - lineWidth) / 2
      const lineStartX = currentX
      const baselineY = currentTop + line.baselineOffset
      const shadowColor = item.textShadow ? parseGpuTextColor(item.textShadow.color) : undefined
      if (item.textShadow && !shadowColor) return null
      for (const char of line.text) {
        const metrics = this.ensureGlyph(char, line.font, line.fontSize)
        if (!metrics) return null
        if (char !== ' ') {
          if (item.textShadow && shadowColor) {
            glyphs.push({
              metrics,
              x: currentX + metrics.offsetX + item.textShadow.offsetX,
              y: baselineY + metrics.offsetY + item.textShadow.offsetY,
              width: metrics.contentWidth,
              height: metrics.contentHeight,
              color: shadowColor,
              shadowBlur: Math.max(0, item.textShadow.blur),
            })
          }
          glyphs.push({
            metrics,
            x: currentX + metrics.offsetX,
            y: baselineY + metrics.offsetY,
            width: metrics.contentWidth,
            height: metrics.contentHeight,
            color: line.color,
            strokeColor: line.strokeColor,
            strokeWidth: line.strokeWidth,
          })
        }
        currentX += metrics.advance + line.letterSpacing
      }
      if (line.underline && lineWidth > 0) {
        const underlineGlyph = this.ensureSolidGlyph()
        if (!underlineGlyph) return null
        if (item.textShadow && shadowColor) {
          glyphs.push({
            metrics: underlineGlyph,
            x: lineStartX + item.textShadow.offsetX,
            y: baselineY + Math.max(1, line.fontSize * 0.08) + item.textShadow.offsetY,
            width: lineWidth,
            height: Math.max(1, line.fontSize * 0.05),
            color: shadowColor,
            solidRadius: 0,
          })
        }
        glyphs.push({
          metrics: underlineGlyph,
          x: lineStartX,
          y: baselineY + Math.max(1, line.fontSize * 0.08),
          width: lineWidth,
          height: Math.max(1, line.fontSize * 0.05),
          color: line.color,
          solidRadius: 0,
        })
      }
      currentTop += line.lineHeightPx
    }
    return { glyphs }
  }

  private layoutLines(item: TextItem, availableWidth: number): TextLayoutLine[] | null {
    const itemFontSize = item.fontSize ?? 60
    const itemFontFamily = item.fontFamily ?? 'Inter'
    const itemFontStyle = item.fontStyle ?? 'normal'
    const itemFontWeightName = item.fontWeight ?? 'normal'
    const itemFontWeight = FONT_WEIGHT_MAP[itemFontWeightName] ?? 400
    const itemLineHeight = item.lineHeight ?? 1.2
    const lines: TextLayoutLine[] = []

    for (const span of getTextItemSpans(item)) {
      const fontSize = span.fontSize ?? itemFontSize
      const fontFamily = span.fontFamily ?? itemFontFamily
      const fontStyle = span.fontStyle ?? itemFontStyle
      const fontWeightName = span.fontWeight ?? itemFontWeightName
      const fontWeight = FONT_WEIGHT_MAP[fontWeightName] ?? itemFontWeight
      const font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`
      const lineHeightPx = fontSize * itemLineHeight
      const letterSpacing = span.letterSpacing ?? item.letterSpacing ?? 0
      const color = parseGpuTextColor(span.color ?? item.color ?? '#ffffff')
      if (!color) return null
      const strokeWidth = Math.max(0, item.stroke?.width ?? 0)
      let strokeColor: [number, number, number, number] | undefined
      if (strokeWidth > 0) {
        const parsedStrokeColor = parseGpuTextColor(item.stroke?.color ?? '#000000')
        if (!parsedStrokeColor) return null
        strokeColor = parsedStrokeColor
      }
      const underline = span.underline ?? item.underline ?? false
      const metrics = this.measureFont(font, fontSize)
      const halfLeading = (lineHeightPx - metrics.height) / 2
      const baselineOffset = halfLeading + metrics.ascent
      for (const line of this.wrapText(span.text ?? '', font, availableWidth, letterSpacing)) {
        lines.push({
          text: line,
          font,
          fontSize,
          lineHeightPx,
          baselineOffset,
          letterSpacing,
          color,
          strokeColor,
          strokeWidth,
          underline,
        })
      }
    }
    return lines
  }

  private measureFont(font: string, fontSize: number): { ascent: number; height: number } {
    this.scratchCtx.font = font
    const metrics = this.scratchCtx.measureText('Hg')
    const ascent =
      metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || fontSize * 0.8
    const descent =
      metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || fontSize * 0.2
    return { ascent, height: ascent + descent }
  }

  private wrapText(text: string, font: string, maxWidth: number, letterSpacing: number): string[] {
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
      if (paragraph === '') {
        lines.push('')
        continue
      }
      const words = paragraph.split(' ')
      let currentLine = ''
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        if (this.measureText(testLine, font, letterSpacing) > maxWidth && currentLine) {
          lines.push(currentLine)
          currentLine = word
          if (this.measureText(word, font, letterSpacing) > maxWidth) {
            const brokenLines = this.breakWord(word, font, maxWidth, letterSpacing)
            for (let i = 0; i < brokenLines.length - 1; i++) lines.push(brokenLines[i] ?? '')
            currentLine = brokenLines[brokenLines.length - 1] ?? ''
          }
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) lines.push(currentLine)
    }
    return lines.length > 0 ? lines : ['']
  }

  private breakWord(word: string, font: string, maxWidth: number, letterSpacing: number): string[] {
    const lines: string[] = []
    let current = ''
    for (const char of word) {
      const test = current + char
      if (this.measureText(test, font, letterSpacing) > maxWidth && current) {
        lines.push(current)
        current = char
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
    return lines
  }

  private measureText(text: string, font: string, letterSpacing: number): number {
    const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font)
    const fontSize = sizeMatch ? parseFloat(sizeMatch[1]!) : 16
    let width = 0
    for (const char of text) {
      width += this.ensureGlyph(char, font, fontSize)?.advance ?? 0
    }
    return width + Math.max(0, text.length - 1) * letterSpacing
  }

  private ensureGlyph(char: string, font: string, fontSize: number): GlyphMetrics | null {
    const key = `${font}\n${char}`
    const cached = this.glyphs.get(key)
    if (cached) return cached

    this.scratchCtx.font = font
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

function writeGlyphVertices(data: Float32Array, offset: number, glyph: PackedGlyph): number {
  const { metrics } = glyph
  const { color } = glyph
  const x0 = glyph.x
  const y0 = glyph.y
  const x1 = glyph.x + glyph.width
  const y1 = glyph.y + glyph.height
  const u0 = metrics.atlasX / ATLAS_SIZE
  const v0 = metrics.atlasY / ATLAS_SIZE
  const u1 = (metrics.atlasX + metrics.atlasWidth) / ATLAS_SIZE
  const v1 = (metrics.atlasY + metrics.atlasHeight) / ATLAS_SIZE
  const vertices = [
    [x0, y0, u0, v0],
    [x1, y0, u1, v0],
    [x0, y1, u0, v1],
    [x0, y1, u0, v1],
    [x1, y0, u1, v0],
    [x1, y1, u1, v1],
  ]
  const solidMode = glyph.solidRadius === undefined ? 0 : 1
  const solidRadius = glyph.solidRadius ?? 0
  const strokeColor = glyph.strokeColor ?? [0, 0, 0, 0]
  const strokeWidth = glyph.strokeWidth ?? 0
  const shadowBlur = glyph.shadowBlur ?? 0
  for (const vertex of vertices) {
    data[offset++] = vertex[0] ?? 0
    data[offset++] = vertex[1] ?? 0
    data[offset++] = vertex[2] ?? 0
    data[offset++] = vertex[3] ?? 0
    data[offset++] = color[0]
    data[offset++] = color[1]
    data[offset++] = color[2]
    data[offset++] = color[3]
    data[offset++] = solidMode
    data[offset++] = x0
    data[offset++] = y0
    data[offset++] = glyph.width
    data[offset++] = glyph.height
    data[offset++] = solidRadius
    data[offset++] = strokeColor[0]
    data[offset++] = strokeColor[1]
    data[offset++] = strokeColor[2]
    data[offset++] = strokeColor[3]
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
