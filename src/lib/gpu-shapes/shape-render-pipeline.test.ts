import { describe, expect, it, vi } from 'vite-plus/test'
import { ShapeRenderPipeline } from './shape-render-pipeline'

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const outputView = {}
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
    createShaderModule: vi.fn(() => 'shader-module'),
    queue,
  }
  const pipeline = new ShapeRenderPipeline(device as unknown as GPUDevice)
  return { commandEncoder, device, outputTexture, pass, pipeline, queue }
}

describe('ShapeRenderPipeline', () => {
  it('renders an analytic shape into the output texture', () => {
    const { commandEncoder, device, outputTexture, pass, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 120, width: 640, height: 360 },
      rotationRad: Math.PI / 4,
      opacity: 0.8,
      shapeType: 'star',
      fillColor: [1, 0, 0, 1],
      strokeColor: [0, 1, 0, 1],
      strokeWidth: 12,
      points: 7,
      innerRadius: 0.4,
    })

    expect(rendered).toBe(true)
    expect(device.createBuffer).toHaveBeenCalledWith({
      size: 352,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData.length).toBe(88)
    expect(Array.from(uniformData.slice(0, 3))).toEqual([1920, 1080, 5])
    expect(uniformData[3]).toBeCloseTo(0.8)
    expect(Array.from(uniformData.slice(4, 19))).toEqual([
      100, 120, 640, 360, 1, 0, 0, 1, 0, 1, 0, 1, 0, 12, 7,
    ])
    expect(uniformData[19]).toBeCloseTo(0.4)
    expect(uniformData[20]).toBeCloseTo(Math.PI / 4)
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

  it('reuses the shape bind group across frames', () => {
    const { device, outputTexture, pipeline } = createPipelineHarness()
    const params = {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 0, y: 0, width: 200, height: 200 },
      shapeType: 'rectangle' as const,
      fillColor: [1, 1, 1, 1] as [number, number, number, number],
    }

    expect(pipeline.renderShapeToTexture(outputTexture, params)).toBe(true)
    expect(pipeline.renderShapeToTexture(outputTexture, params)).toBe(true)

    expect(device.createBindGroup).toHaveBeenCalledTimes(1)
  })

  it('accepts heart shapes as analytic GPU shapes', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 100, width: 300, height: 240 },
      shapeType: 'heart',
      fillColor: [1, 0, 0, 1],
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[2]).toBe(6)
  })

  it('packs straight custom path vertices for GPU polygon rendering', () => {
    const { outputTexture, pipeline, queue } = createPipelineHarness()

    const rendered = pipeline.renderShapeToTexture(outputTexture, {
      outputWidth: 1920,
      outputHeight: 1080,
      transformRect: { x: 100, y: 100, width: 300, height: 240 },
      shapeType: 'path',
      fillColor: [1, 0, 0, 1],
      pathVertices: [
        [-150, -120],
        [150, -120],
        [0, 120],
      ],
    })

    expect(rendered).toBe(true)
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[2]).toBe(7)
    expect(uniformData[18]).toBe(3)
    expect(Array.from(uniformData.slice(24, 36))).toEqual([
      -150, -120, 0, 0, 150, -120, 0, 0, 0, 120, 0, 0,
    ])
  })
})
