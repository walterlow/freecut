import { describe, expect, it, vi } from 'vite-plus/test'
import { MediaRenderPipeline } from './media-render-pipeline'

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  vi.stubGlobal('GPUTextureUsage', { COPY_DST: 2, TEXTURE_BINDING: 4 })
  const queue = {
    copyExternalImageToTexture: vi.fn(),
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const inputView = {}
  const outputView = {}
  const inputTexture = {
    createView: vi.fn(() => inputView),
    destroy: vi.fn(),
    width: 1920,
    height: 1080,
  }
  const outputTexture = {
    createView: vi.fn(() => outputView),
    width: 1920,
    height: 1080,
  } as unknown as GPUTexture
  const pass = {
    draw: vi.fn(),
    end: vi.fn(),
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
  }
  const commandEncoder = {
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => 'finished-command-buffer'),
  }
  const device = {
    createBindGroup: vi.fn(() => 'bind-group'),
    createBindGroupLayout: vi.fn(() => 'bind-group-layout'),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => commandEncoder),
    createPipelineLayout: vi.fn(() => 'pipeline-layout'),
    createRenderPipeline: vi.fn(() => 'render-pipeline'),
    createSampler: vi.fn(() => 'sampler'),
    createShaderModule: vi.fn(() => 'shader-module'),
    createTexture: vi.fn(() => inputTexture),
    queue,
  }
  const pipeline = new MediaRenderPipeline(device as unknown as GPUDevice)

  return { commandEncoder, device, inputTexture, outputTexture, pass, pipeline, queue }
}

describe('MediaRenderPipeline', () => {
  it('uploads a media source and renders it into the output texture', () => {
    const { commandEncoder, device, inputTexture, outputTexture, pass, pipeline, queue } =
      createPipelineHarness()
    const source = { width: 1920, height: 1080 } as OffscreenCanvas

    const rendered = pipeline.renderSourceToTexture(source, outputTexture, {
      sourceWidth: 1920,
      sourceHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      sourceRect: { x: 100, y: 50, width: 500, height: 400 },
      destRect: { x: 200, y: 100, width: 700, height: 500 },
      transformRect: { x: 160, y: 80, width: 800, height: 600 },
      featherPixels: { left: 20, right: 30, top: 10, bottom: 40 },
      cornerRadius: 24,
      cornerPin: {
        originX: 180,
        originY: 90,
        width: 720,
        height: 540,
        inverseMatrix: [1, 0, -8, 0, 1, -6, 0.001, 0.002, 1],
      },
      opacity: 0.75,
      rotationRad: Math.PI / 2,
      flipX: true,
      flipY: false,
    })

    expect(rendered).toBe(true)
    expect(device.createTexture).toHaveBeenCalledWith({
      size: { width: 1920, height: 1080 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    expect(device.createBuffer).toHaveBeenCalledWith({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    expect(queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source, flipY: false },
      { texture: inputTexture },
      { width: 1920, height: 1080 },
    )
    expect(queue.writeBuffer).toHaveBeenCalled()
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData.length).toBe(44)
    expect(Array.from(uniformData.slice(0, 13))).toEqual([
      1920, 1080, 1920, 1080, 100, 50, 500, 400, 200, 100, 700, 500, 0.75,
    ])
    expect(uniformData[13]).toBeCloseTo(Math.PI / 2)
    expect(uniformData[14]).toBe(-1)
    expect(uniformData[15]).toBe(1)
    expect(Array.from(uniformData.slice(16, 28))).toEqual([
      160, 80, 800, 600, 20, 30, 10, 40, 24, 1, 0, 0,
    ])
    expect(Array.from(uniformData.slice(28, 40))).toEqual([
      180, 90, 720, 540, 1, 0, -8, 0, 0, 1, -6, 0,
    ])
    expect(uniformData[40]).toBeCloseTo(0.001)
    expect(uniformData[41]).toBeCloseTo(0.002)
    expect(Array.from(uniformData.slice(42, 44))).toEqual([1, 0])
    expect(commandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [
        {
          view: {},
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    expect(pass.setPipeline).toHaveBeenCalledWith('render-pipeline')
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, 'bind-group')
    expect(pass.draw).toHaveBeenCalledWith(6)
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
    expect(outputTexture.createView).toHaveBeenCalled()
  })

  it('reuses the media bind group while the input texture dimensions are unchanged', () => {
    const { device, outputTexture, pipeline } = createPipelineHarness()
    const source = { width: 1920, height: 1080 } as OffscreenCanvas
    const params = {
      sourceWidth: 1920,
      sourceHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      destRect: { x: 0, y: 0, width: 1920, height: 1080 },
    }

    expect(pipeline.renderSourceToTexture(source, outputTexture, params)).toBe(true)
    expect(pipeline.renderSourceToTexture(source, outputTexture, params)).toBe(true)

    expect(device.createBindGroup).toHaveBeenCalledTimes(1)
  })

  it('renders an existing GPU texture without uploading an external source', () => {
    const { device, outputTexture, pipeline, queue } = createPipelineHarness()
    const sourceTexture = {
      width: 640,
      height: 180,
      createView: vi.fn(() => 'cached-text-view'),
    } as unknown as GPUTexture

    expect(
      pipeline.renderTextureToTexture(sourceTexture, outputTexture, {
        sourceWidth: 640,
        sourceHeight: 180,
        outputWidth: 1920,
        outputHeight: 1080,
        destRect: { x: 640, y: 450, width: 640, height: 180 },
      }),
    ).toBe(true)

    expect(queue.copyExternalImageToTexture).not.toHaveBeenCalled()
    expect(sourceTexture.createView).toHaveBeenCalled()
    expect(device.createBindGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 1, resource: 'cached-text-view' }),
        ]),
      }),
    )
  })
})
