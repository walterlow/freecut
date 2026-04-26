import { describe, expect, it, vi } from 'vite-plus/test'
import { MediaBlendPipeline } from './media-blend-pipeline'

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const baseTexture = {
    createView: vi.fn(() => 'base-view'),
    width: 640,
    height: 360,
  } as unknown as GPUTexture
  const layerTexture = {
    createView: vi.fn(() => 'layer-view'),
    width: 640,
    height: 360,
  } as unknown as GPUTexture
  const outputTexture = {
    createView: vi.fn(() => 'output-view'),
    width: 640,
    height: 360,
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
    queue,
  }
  const pipeline = new MediaBlendPipeline(device as unknown as GPUDevice)
  return { baseTexture, commandEncoder, device, layerTexture, outputTexture, pass, pipeline, queue }
}

describe('MediaBlendPipeline', () => {
  it('uses layer opacity as dissolve coverage instead of source alpha', () => {
    const { device } = createPipelineHarness()

    expect(device.createShaderModule).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.stringContaining('input.uv * 8192.0,\n    u.x'),
      }),
    )
  })

  it('blends a full layer texture over a base texture', () => {
    const {
      baseTexture,
      commandEncoder,
      device,
      layerTexture,
      outputTexture,
      pass,
      pipeline,
      queue,
    } = createPipelineHarness()

    expect(pipeline.blend(baseTexture, layerTexture, outputTexture, 'multiply', 0.75)).toBe(true)

    expect(device.createBindGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 1, resource: 'base-view' }),
          expect.objectContaining({ binding: 2, resource: 'layer-view' }),
        ]),
      }),
    )
    const uniformData = queue.writeBuffer.mock.calls[0]?.[2] as Float32Array
    expect(uniformData[0]).toBe(0.75)
    expect(new Uint32Array(uniformData.buffer, 4, 1)[0]).toBe(3)
    expect(commandEncoder.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [
        {
          view: 'output-view',
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
  })
})
