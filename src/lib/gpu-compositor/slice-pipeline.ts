/**
 * Slice Pipeline — GPU renderer for corner-pin warped meshes.
 *
 * Takes pre-computed vertex data from corner-pin.ts and renders it
 * with texture sampling. Vertex format: [posX, posY, uvX, uvY].
 */

const SLICE_SHADER = /* wgsl */ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(input.position, 0.0, 1.0);
  output.uv = input.uv;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(srcTexture, texSampler, input.uv);
}
`;

export class SlicePipeline {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private sampler: GPUSampler;
  private vertexBuffer: GPUBuffer | null = null;
  private vertexBufferSize = 0;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const module = device.createShaderModule({ label: 'slice', code: SLICE_SHADER });

    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'slice-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      label: 'slice-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 16, // 4 floats × 4 bytes
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // position
            { shaderLocation: 1, offset: 8, format: 'float32x2' },  // uv
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /**
   * Render a corner-pinned mesh to an output texture.
   *
   * @param vertexData - Interleaved [posX, posY, uvX, uvY] from generateCornerPinMesh
   * @param sourceView - Texture view of the source image/video
   * @param outputView - Render target texture view
   * @param commandEncoder - GPU command encoder
   */
  render(
    vertexData: Float32Array,
    sourceView: GPUTextureView,
    outputView: GPUTextureView,
    commandEncoder: GPUCommandEncoder,
  ): void {
    const byteSize = vertexData.byteLength;

    // Resize vertex buffer if needed
    if (!this.vertexBuffer || this.vertexBufferSize < byteSize) {
      this.vertexBuffer?.destroy();
      this.vertexBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.vertexBufferSize = byteSize;
    }

    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData.buffer);

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: sourceView },
      ],
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outputView,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(vertexData.length / 4); // 4 floats per vertex
    pass.end();
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.vertexBuffer = null;
  }
}
