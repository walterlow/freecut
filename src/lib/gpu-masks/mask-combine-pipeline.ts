const MASK_COMBINE_SHADER = /* wgsl */ `
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

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseMask: texture_2d<f32>;
@group(0) @binding(2) var nextMask: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: vec4f;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var a = textureSampleLevel(baseMask, texSampler, input.uv, 0.0).a;
  var b = textureSampleLevel(nextMask, texSampler, input.uv, 0.0).a;
  if (u.x > 0.5) {
    a = 1.0 - a;
  }
  if (u.y > 0.5) {
    b = 1.0 - b;
  }
  let alpha = a * b;
  return vec4f(1.0, 1.0, 1.0, alpha);
}
`

export class MaskCombinePipeline {
  private readonly pipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly bindGroupLayout: GPUBindGroupLayout
  private readonly uniformBuffer: GPUBuffer

  constructor(private readonly device: GPUDevice) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const shaderModule = device.createShaderModule({
      label: 'mask-combine',
      code: MASK_COMBINE_SHADER,
    })
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'mask-combine-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    this.pipeline = device.createRenderPipeline({
      label: 'mask-combine-pipeline',
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

  combine(
    baseMask: GPUTexture,
    nextMask: GPUTexture,
    outputTexture: GPUTexture,
    options?: { invertBase?: boolean; invertNext?: boolean },
  ): boolean {
    if (
      baseMask.width !== nextMask.width ||
      baseMask.height !== nextMask.height ||
      outputTexture.width !== baseMask.width ||
      outputTexture.height !== baseMask.height
    ) {
      return false
    }
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([options?.invertBase ? 1 : 0, options?.invertNext ? 1 : 0, 0, 0]),
    )
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: baseMask.createView() },
        { binding: 2, resource: nextMask.createView() },
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
