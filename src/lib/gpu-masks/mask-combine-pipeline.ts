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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let a = textureSampleLevel(baseMask, texSampler, input.uv, 0.0).a;
  let b = textureSampleLevel(nextMask, texSampler, input.uv, 0.0).a;
  let alpha = a * b;
  return vec4f(1.0, 1.0, 1.0, alpha);
}
`

export class MaskCombinePipeline {
  private readonly pipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly bindGroupLayout: GPUBindGroupLayout

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
  }

  combine(baseMask: GPUTexture, nextMask: GPUTexture, outputTexture: GPUTexture): boolean {
    if (
      baseMask.width !== nextMask.width ||
      baseMask.height !== nextMask.height ||
      outputTexture.width !== baseMask.width ||
      outputTexture.height !== baseMask.height
    ) {
      return false
    }
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: baseMask.createView() },
        { binding: 2, resource: nextMask.createView() },
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
    // No explicit GPU resources owned besides pipeline/layout/sampler handles.
  }
}
