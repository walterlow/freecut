import { describe, expect, it, vi } from 'vite-plus/test'
import { MaskCombinePipeline } from './mask-combine-pipeline'

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const baseMask = {
    createView: vi.fn(() => 'base-view'),
    width: 640,
    height: 360,
  } as unknown as GPUTexture
  const nextMask = {
    createView: vi.fn(() => 'next-view'),
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
  const pipeline = new MaskCombinePipeline(device as unknown as GPUDevice)
  return { baseMask, commandEncoder, device, nextMask, outputTexture, pass, pipeline, queue }
}

describe('MaskCombinePipeline', () => {
  it('multiplies two mask textures into an output texture', () => {
    const { baseMask, commandEncoder, device, nextMask, outputTexture, pass, pipeline, queue } =
      createPipelineHarness()

    expect(pipeline.combine(baseMask, nextMask, outputTexture)).toBe(true)

    expect(device.createBindGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ binding: 1, resource: 'base-view' }),
          expect.objectContaining({ binding: 2, resource: 'next-view' }),
          expect.objectContaining({ binding: 3, resource: { buffer: expect.anything() } }),
        ]),
      }),
    )
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([0, 0, 0, 0]),
    )
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

  it('passes inversion flags through the combine uniform', () => {
    const { baseMask, nextMask, outputTexture, pipeline, queue } = createPipelineHarness()

    expect(
      pipeline.combine(baseMask, nextMask, outputTexture, { invertBase: true, invertNext: true }),
    ).toBe(true)

    expect(queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([1, 1, 0, 0]),
    )
  })
})
