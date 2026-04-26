import type { BlendMode } from '@/types/blend-modes'
import { BLEND_MODE_INDEX } from '@/types/blend-modes'
import { BLEND_MODES_WGSL } from '@/lib/gpu-shared/blend-modes'

const MEDIA_BLEND_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
    vec2f(-1,1), vec2f(1,-1), vec2f(1,1)
  );
  var uv = array<vec2f, 6>(
    vec2f(0,1), vec2f(1,1), vec2f(0,0),
    vec2f(0,0), vec2f(1,1), vec2f(1,0)
  );
  var o: VertexOutput;
  o.position = vec4f(pos[vi], 0, 1);
  o.uv = uv[vi];
  return o;
}

${BLEND_MODES_WGSL}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: vec4f;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSampleLevel(baseTex, texSampler, input.uv, 0.0);
  let layerColor = textureSampleLevel(layerTex, texSampler, input.uv, 0.0);
  let layerAlpha = layerColor.a * u.x;
  if (layerAlpha <= 0.0) {
    return baseColor;
  }
  return compositeBlendSourceOver(
    baseColor,
    layerColor,
    layerAlpha,
    1.0,
    bitcast<u32>(u.y),
    input.uv * 8192.0,
    u.x
  );
}
`

export class MediaBlendPipeline {
  private readonly pipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly bindGroupLayout: GPUBindGroupLayout
  private readonly uniformBuffer: GPUBuffer

  constructor(private readonly device: GPUDevice) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const shaderModule = device.createShaderModule({
      label: 'media-blend',
      code: MEDIA_BLEND_SHADER,
    })
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'media-blend-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    this.pipeline = device.createRenderPipeline({
      label: 'media-blend-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  blend(
    baseTexture: GPUTexture,
    layerTexture: GPUTexture,
    outputTexture: GPUTexture,
    blendMode: BlendMode,
    opacity = 1,
  ): boolean {
    if (
      baseTexture.width !== layerTexture.width ||
      baseTexture.height !== layerTexture.height ||
      outputTexture.width !== baseTexture.width ||
      outputTexture.height !== baseTexture.height
    ) {
      return false
    }

    const uniformData = new Float32Array([opacity, 0, 0, 0])
    new Uint32Array(uniformData.buffer, 4, 1)[0] = BLEND_MODE_INDEX[blendMode] ?? 0
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData)

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: baseTexture.createView() },
        { binding: 2, resource: layerTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    })
    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputTexture.createView(),
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  destroy(): void {
    this.uniformBuffer.destroy()
  }
}
