import { describe, expect, it, vi } from 'vite-plus/test'
import { GlyphAtlasTextPipeline } from './glyph-atlas-text-pipeline'
import type { TextItem } from '@/types/timeline'

class MockOffscreenCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext() {
    return {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
        data: createGlyphPixels(width, height),
      })),
      measureText: vi.fn((text: string) => ({
        width: text.length * 12,
        actualBoundingBoxAscent: 16,
        actualBoundingBoxDescent: 4,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: Math.max(1, text.length * 12),
      })),
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    }
  }
}

function createGlyphPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      const index = (y * width + x) * 4
      data[index] = 255
      data[index + 1] = 255
      data[index + 2] = 255
      data[index + 3] = 255
    }
  }
  return data
}

function createPipelineHarness() {
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2, VERTEX: 1 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64, VERTEX: 32 })
  vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4 })
  const atlasView = {}
  const atlasTexture = {
    createView: vi.fn(() => atlasView),
    destroy: vi.fn(),
  }
  const outputView = {}
  const outputTexture = {
    createView: vi.fn(() => outputView),
    width: 640,
    height: 180,
  } as unknown as GPUTexture
  const uniformBuffer = { destroy: vi.fn(), label: 'uniform-buffer' }
  const vertexBuffer = { destroy: vi.fn(), label: 'vertex-buffer' }
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
    writeTexture: vi.fn(),
  }
  const pass = {
    draw: vi.fn(),
    end: vi.fn(),
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
    setVertexBuffer: vi.fn(),
  }
  const commandEncoder = {
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => 'finished-command-buffer'),
  }
  const device = {
    createBindGroup: vi.fn(() => 'bind-group'),
    createBindGroupLayout: vi.fn(() => 'bind-group-layout'),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) =>
      descriptor.usage === (GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
        ? uniformBuffer
        : vertexBuffer,
    ),
    createCommandEncoder: vi.fn(() => commandEncoder),
    createPipelineLayout: vi.fn(() => 'pipeline-layout'),
    createRenderPipeline: vi.fn(() => 'render-pipeline'),
    createSampler: vi.fn(() => 'sampler'),
    createShaderModule: vi.fn(() => 'shader-module'),
    createTexture: vi.fn(() => atlasTexture),
    queue,
  }
  const pipeline = new GlyphAtlasTextPipeline(device as unknown as GPUDevice)

  return {
    atlasTexture,
    commandEncoder,
    device,
    outputTexture,
    pass,
    pipeline,
    queue,
    uniformBuffer,
    vertexBuffer,
  }
}

describe('GlyphAtlasTextPipeline', () => {
  it('uploads glyphs into the atlas and renders glyph quads', () => {
    const { commandEncoder, outputTexture, pass, pipeline, queue, vertexBuffer } =
      createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'AB',
        color: '#336699',
        fontSize: 48,
        fontFamily: 'Inter',
      } as TextItem,
    })

    expect(rendered).toBe(true)
    expect(queue.writeTexture).toHaveBeenCalledTimes(2)
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      vertexBuffer,
      0,
      expect.any(Float32Array),
      0,
      240,
    )
    const vertexData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(vertexData[4]).toBeCloseTo(0.2)
    expect(vertexData[5]).toBeCloseTo(0.4)
    expect(vertexData[6]).toBeCloseTo(0.6)
    expect(vertexData[7]).toBeCloseTo(1)
    expect(commandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [{ view: {}, loadOp: 'clear', storeOp: 'store' }],
    })
    expect(pass.setPipeline).toHaveBeenCalledWith('render-pipeline')
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, 'bind-group')
    expect(pass.setVertexBuffer).toHaveBeenCalledWith(0, vertexBuffer)
    expect(pass.draw).toHaveBeenCalledWith(12)
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
  })

  it('reuses cached glyph atlas entries across renders', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()
    const params = {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'AA',
        color: '#ffffff',
        fontSize: 48,
        fontFamily: 'Inter',
      } as TextItem,
    }

    expect(pipeline.renderTextToTexture(outputTexture, params)).toBe(true)
    expect(pipeline.renderTextToTexture(outputTexture, params)).toBe(true)

    expect(queue.writeTexture).toHaveBeenCalledTimes(1)
  })

  it('packs per-span colors into glyph vertices', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        textSpans: [
          { text: 'A', color: '#ff0000', fontSize: 48 },
          { text: 'B', color: '#00ff00', fontSize: 32 },
        ],
        color: '#ffffff',
        fontFamily: 'Inter',
      } as TextItem,
    })

    expect(rendered).toBe(true)
    const vertexData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(vertexData[4]).toBeCloseTo(1)
    expect(vertexData[5]).toBeCloseTo(0)
    expect(vertexData[6]).toBeCloseTo(0)
    expect(vertexData[124]).toBeCloseTo(0)
    expect(vertexData[125]).toBeCloseTo(1)
    expect(vertexData[126]).toBeCloseTo(0)
  })

  it('renders flat backgrounds and underlines as solid GPU quads', () => {
    const { outputTexture, pass, pipeline, queue, vertexBuffer } = createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'A',
        color: '#ffffff',
        backgroundColor: '#112233',
        backgroundRadius: 8,
        fontSize: 48,
        fontFamily: 'Inter',
        textPadding: 0,
        underline: true,
      } as TextItem,
    })

    expect(rendered).toBe(true)
    expect(queue.writeTexture).toHaveBeenCalledTimes(2)
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      vertexBuffer,
      0,
      expect.any(Float32Array),
      0,
      360,
    )
    const vertexData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(vertexData[0]).toBeCloseTo(0)
    expect(vertexData[1]).toBeCloseTo(0)
    expect(vertexData[4]).toBeCloseTo(0x11 / 255)
    expect(vertexData[5]).toBeCloseTo(0x22 / 255)
    expect(vertexData[6]).toBeCloseTo(0x33 / 255)
    expect(vertexData[8]).toBeCloseTo(1)
    expect(vertexData[13]).toBeCloseTo(8)
    expect(vertexData[124]).toBeCloseTo(1)
    expect(vertexData[125]).toBeCloseTo(1)
    expect(vertexData[126]).toBeCloseTo(1)
    expect(vertexData[244]).toBeCloseTo(1)
    expect(vertexData[245]).toBeCloseTo(1)
    expect(vertexData[246]).toBeCloseTo(1)
    expect(vertexData[248]).toBeCloseTo(1)
    expect(vertexData[253]).toBeCloseTo(0)
    expect(pass.draw).toHaveBeenCalledWith(18)
  })

  it('packs text stroke color and width for SDF outline rendering', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'A',
        color: '#ffffff',
        fontSize: 48,
        fontFamily: 'Inter',
        stroke: { width: 3, color: '#0000ff' },
      } as TextItem,
    })

    expect(rendered).toBe(true)
    const vertexData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(vertexData[14]).toBeCloseTo(0)
    expect(vertexData[15]).toBeCloseTo(0)
    expect(vertexData[16]).toBeCloseTo(1)
    expect(vertexData[17]).toBeCloseTo(1)
    expect(vertexData[18]).toBeCloseTo(3)
  })

  it('emits shadow glyphs before foreground text glyphs', () => {
    const { outputTexture, pass, pipeline, queue, vertexBuffer } = createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 640,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'A',
        color: '#ffffff',
        fontSize: 48,
        fontFamily: 'Inter',
        textShadow: { offsetX: 4, offsetY: 5, blur: 6, color: '#00000080' },
      } as TextItem,
    })

    expect(rendered).toBe(true)
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      vertexBuffer,
      0,
      expect.any(Float32Array),
      0,
      240,
    )
    const vertexData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(vertexData[4]).toBeCloseTo(0)
    expect(vertexData[5]).toBeCloseTo(0)
    expect(vertexData[6]).toBeCloseTo(0)
    expect(vertexData[7]).toBeCloseTo(0x80 / 255)
    expect(vertexData[19]).toBeCloseTo(6)
    expect(vertexData[124]).toBeCloseTo(1)
    expect(vertexData[125]).toBeCloseTo(1)
    expect(vertexData[126]).toBeCloseTo(1)
    expect(vertexData[139]).toBeCloseTo(0)
    expect(pass.draw).toHaveBeenCalledWith(12)
  })

  it('rejects text that would overflow the fixed vertex buffer', () => {
    const { outputTexture, pass, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderTextToTexture(outputTexture, {
      outputWidth: 640,
      outputHeight: 180,
      width: 100000,
      height: 180,
      item: {
        id: 'text',
        type: 'text',
        trackId: 'track',
        from: 0,
        durationInFrames: 30,
        text: 'A'.repeat(4097),
        color: '#ffffff',
        fontSize: 48,
        fontFamily: 'Inter',
        textPadding: 0,
      } as TextItem,
    })

    expect(rendered).toBe(false)
    expect(pass.draw).not.toHaveBeenCalled()
    expect(queue.submit).not.toHaveBeenCalled()
  })
})
