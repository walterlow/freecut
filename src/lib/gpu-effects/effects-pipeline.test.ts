import { describe, expect, it, vi } from 'vite-plus/test'
import { EffectsPipeline } from './effects-pipeline'
import type { GpuEffectInstance } from './types'

function createPipelineHarness() {
  const queue = {
    copyExternalImageToTexture: vi.fn(),
    onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn(),
  }
  const pipeline = Object.create(EffectsPipeline.prototype) as any
  const commandEncoder = {
    copyTextureToTexture: vi.fn(),
    finish: vi.fn(() => 'finished-command-buffer'),
  }
  const device = {
    createCommandEncoder: vi.fn(() => commandEncoder),
    queue,
  }
  pipeline.device = device
  pipeline.gpuFramesInFlight = 0
  pipeline.pingTexture = null
  pipeline.pongTexture = null
  pipeline.ensurePingPong = vi.fn((_w, _h) => {
    pipeline.pingTexture = { width: 1920, height: 1080 } as GPUTexture
    pipeline.pongTexture = { width: 1920, height: 1080 } as GPUTexture
  })
  pipeline.runEffectChain = vi.fn((_encoder, _effects, _startInput, startOutput) => startOutput)

  return { commandEncoder, device, pipeline, queue }
}

describe('EffectsPipeline.applyEffectsToTexture', () => {
  it('copies directly into the output texture when no effects are enabled', () => {
    const { device, pipeline, queue } = createPipelineHarness()
    const source = { width: 1920, height: 1080 } as OffscreenCanvas
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture

    const result = pipeline.applyEffectsToTexture(source, [], outputTexture)

    expect(result).toBe(true)
    expect(queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source, flipY: false },
      { texture: outputTexture },
      { width: 1920, height: 1080 },
    )
    expect(device.createCommandEncoder).not.toHaveBeenCalled()
    expect(queue.submit).not.toHaveBeenCalled()
  })

  it('runs the effect chain and copies the final GPU texture into the output texture', async () => {
    const { commandEncoder, device, pipeline, queue } = createPipelineHarness()
    const source = { width: 1920, height: 1080 } as OffscreenCanvas
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const effects: GpuEffectInstance[] = [
      {
        id: 'fx-1',
        type: 'gpu-blur',
        name: 'gpu-blur',
        enabled: true,
        params: { amount: 0.5 },
      },
    ]

    const result = pipeline.applyEffectsToTexture(source, effects, outputTexture)

    expect(result).toBe(true)
    expect(pipeline.ensurePingPong).toHaveBeenCalledWith(1920, 1080)
    expect(queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source, flipY: false },
      { texture: pipeline.pingTexture },
      { width: 1920, height: 1080 },
    )
    expect(pipeline.runEffectChain).toHaveBeenCalledWith(
      commandEncoder,
      effects,
      pipeline.pingTexture,
      pipeline.pongTexture,
      1920,
      1080,
    )
    expect(commandEncoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: pipeline.pongTexture },
      { texture: outputTexture },
      { width: 1920, height: 1080 },
    )
    expect(commandEncoder.finish).toHaveBeenCalled()
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
    expect(queue.onSubmittedWorkDone).toHaveBeenCalled()
    expect(pipeline.gpuFramesInFlight).toBe(1)

    await Promise.resolve()

    expect(pipeline.gpuFramesInFlight).toBe(0)
    expect(device.createCommandEncoder).toHaveBeenCalled()
  })
})

describe('EffectsPipeline.applyTextureEffectsToTexture', () => {
  it('copies texture input directly when no effects are enabled', () => {
    const { commandEncoder, pipeline, queue } = createPipelineHarness()
    const sourceTexture = { width: 1920, height: 1080 } as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture

    const result = pipeline.applyTextureEffectsToTexture(
      sourceTexture,
      [],
      outputTexture,
      1920,
      1080,
    )

    expect(result).toBe(true)
    expect(commandEncoder.copyTextureToTexture).toHaveBeenCalledWith(
      { texture: sourceTexture },
      { texture: outputTexture },
      { width: 1920, height: 1080 },
    )
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
  })

  it('runs effects from texture input and writes to the output texture', async () => {
    const { commandEncoder, pipeline, queue } = createPipelineHarness()
    const sourceTexture = { width: 1920, height: 1080 } as GPUTexture
    const outputTexture = { width: 1920, height: 1080 } as GPUTexture
    const effects: GpuEffectInstance[] = [
      {
        id: 'fx-1',
        type: 'gpu-blur',
        name: 'gpu-blur',
        enabled: true,
        params: { amount: 0.5 },
      },
    ]

    const result = pipeline.applyTextureEffectsToTexture(
      sourceTexture,
      effects,
      outputTexture,
      1920,
      1080,
    )

    expect(result).toBe(true)
    expect(pipeline.ensurePingPong).toHaveBeenCalledWith(1920, 1080)
    expect(commandEncoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      1,
      { texture: sourceTexture },
      { texture: pipeline.pingTexture },
      { width: 1920, height: 1080 },
    )
    expect(pipeline.runEffectChain).toHaveBeenCalledWith(
      commandEncoder,
      effects,
      pipeline.pingTexture,
      pipeline.pongTexture,
      1920,
      1080,
    )
    expect(commandEncoder.copyTextureToTexture).toHaveBeenNthCalledWith(
      2,
      { texture: pipeline.pongTexture },
      { texture: outputTexture },
      { width: 1920, height: 1080 },
    )
    expect(queue.submit).toHaveBeenCalledWith(['finished-command-buffer'])
    expect(queue.onSubmittedWorkDone).toHaveBeenCalled()
    expect(pipeline.gpuFramesInFlight).toBe(1)

    await Promise.resolve()

    expect(pipeline.gpuFramesInFlight).toBe(0)
  })
})
