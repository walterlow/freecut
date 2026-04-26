import { describe, expect, it, vi } from 'vite-plus/test'
import { BLEND_MODE_INDEX, type BlendMode } from '@/types/blend-modes'
import {
  CompositorPipeline,
  DEFAULT_LAYER_PARAMS,
  type CompositeLayer,
} from './compositor-pipeline'

function createTexture(label: string) {
  return {
    createView: vi.fn(() => `${label}-view`),
    destroy: vi.fn(),
    height: 360,
    width: 640,
  } as unknown as GPUTexture
}

function createPipelineHarness() {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 })
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, UNIFORM: 64 })
  vi.stubGlobal('GPUTextureUsage', {
    COPY_DST: 8,
    COPY_SRC: 4,
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 1,
  })
  vi.stubGlobal('navigator', {
    gpu: {
      getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
    },
  })

  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
  }
  const pass = {
    draw: vi.fn(),
    end: vi.fn(),
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
  }
  const commandEncoder = {
    beginRenderPass: vi.fn(() => pass),
  }
  let textureIndex = 0
  let bufferIndex = 0
  const device = {
    createBindGroup: vi.fn((descriptor) => ({ descriptor })),
    createBindGroupLayout: vi.fn(() => 'bind-group-layout'),
    createBuffer: vi.fn(() => ({ destroy: vi.fn(), id: `uniform-${bufferIndex++}` })),
    createPipelineLayout: vi.fn(() => 'pipeline-layout'),
    createRenderPipeline: vi.fn(() => 'render-pipeline'),
    createSampler: vi.fn(() => 'sampler'),
    createShaderModule: vi.fn(() => 'shader-module'),
    createTexture: vi.fn(() => createTexture(`ping-pong-${textureIndex++}`)),
    queue,
  }
  const pipeline = new CompositorPipeline(device as unknown as GPUDevice)

  return { commandEncoder, device, pass, pipeline, queue }
}

function readHasMask(writeCall: unknown[]): number {
  const buffer = writeCall[2] as ArrayBuffer
  return new Uint32Array(buffer, 40, 1)[0] ?? 0
}

function readBlendMode(writeCall: unknown[]): number {
  const buffer = writeCall[2] as ArrayBuffer
  return new Uint32Array(buffer, 4, 1)[0] ?? 0
}

describe('CompositorPipeline', () => {
  it('keeps mask coverage separate from dissolve opacity coverage in shader code', () => {
    const { device } = createPipelineHarness()

    const shaderSources = (
      device.createShaderModule.mock.calls as unknown as Array<[GPUShaderModuleDescriptor]>
    ).map(([descriptor]) => descriptor.code)
    expect(
      shaderSources.some(
        (code) =>
          code.includes('let postDissolveAlpha = maskValue * select') &&
          code.includes('sourceAlpha,\n    postDissolveAlpha') &&
          code.includes('input.uv * 8192.0,\n    u.opacity'),
      ),
    ).toBe(true)
  })

  it('binds independent uniforms for masked and unmasked layers encoded in one command buffer', () => {
    const { commandEncoder, device, pipeline, queue } = createPipelineHarness()
    const maskedLayerUniform = {
      ...DEFAULT_LAYER_PARAMS,
      blendMode: 'multiply' as const,
      hasMask: true,
    }
    const unmaskedLayerUniform = {
      ...DEFAULT_LAYER_PARAMS,
      blendMode: 'normal' as const,
      hasMask: false,
    }
    const layers: CompositeLayer[] = [
      {
        params: maskedLayerUniform,
        textureView: 'masked-layer-view' as unknown as GPUTextureView,
        maskView: 'heart-mask-view' as unknown as GPUTextureView,
      },
      {
        params: unmaskedLayerUniform,
        textureView: 'top-layer-view' as unknown as GPUTextureView,
        maskView: 'fallback-mask-view' as unknown as GPUTextureView,
      },
    ]

    const result = pipeline.compositeToTexture(
      layers,
      640,
      360,
      commandEncoder as unknown as GPUCommandEncoder,
    )

    expect(result).not.toBeNull()
    expect(queue.writeBuffer).toHaveBeenCalledTimes(2)
    expect(readHasMask(queue.writeBuffer.mock.calls[0]!)).toBe(1)
    expect(readHasMask(queue.writeBuffer.mock.calls[1]!)).toBe(0)

    const layerBindGroups = device.createBindGroup.mock.calls.slice(-2)
    const firstUniformResource = layerBindGroups[0]?.[0].entries.find(
      (entry: GPUBindGroupEntry) => entry.binding === 3,
    )?.resource
    const secondUniformResource = layerBindGroups[1]?.[0].entries.find(
      (entry: GPUBindGroupEntry) => entry.binding === 3,
    )?.resource
    expect(firstUniformResource).not.toBe(secondUniformResource)
  })

  it.each(['normal', 'multiply', 'darken', 'lighten', 'screen', 'dissolve'] satisfies BlendMode[])(
    'preserves mask state when a masked underlay is composited with %s mode',
    (blendMode) => {
      const { commandEncoder, pipeline, queue } = createPipelineHarness()
      const layers: CompositeLayer[] = [
        {
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode,
            hasMask: true,
          },
          textureView: 'video-layer-view' as unknown as GPUTextureView,
          maskView: 'heart-mask-view' as unknown as GPUTextureView,
        },
        {
          params: {
            ...DEFAULT_LAYER_PARAMS,
            blendMode: 'normal',
            hasMask: false,
          },
          textureView: 'shape-layer-view' as unknown as GPUTextureView,
          maskView: 'fallback-mask-view' as unknown as GPUTextureView,
        },
      ]

      const result = pipeline.compositeToTexture(
        layers,
        640,
        360,
        commandEncoder as unknown as GPUCommandEncoder,
      )

      expect(result).not.toBeNull()
      expect(queue.writeBuffer).toHaveBeenCalledTimes(2)
      expect(readBlendMode(queue.writeBuffer.mock.calls[0]!)).toBe(BLEND_MODE_INDEX[blendMode])
      expect(readHasMask(queue.writeBuffer.mock.calls[0]!)).toBe(1)
      expect(readBlendMode(queue.writeBuffer.mock.calls[1]!)).toBe(BLEND_MODE_INDEX.normal)
      expect(readHasMask(queue.writeBuffer.mock.calls[1]!)).toBe(0)
    },
  )
})
