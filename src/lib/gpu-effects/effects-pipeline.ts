import { COMMON_WGSL } from './common';
import type { GpuEffectDefinition, GpuEffectInstance } from './types';
import { GPU_EFFECT_REGISTRY, getGpuEffect } from './index';

const BLIT_SHADER = /* wgsl */ `
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
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}
`;

export class EffectsPipeline {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private pipelines = new Map<string, GPURenderPipeline>();
  private bindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private sampler: GPUSampler;
  private blitPipeline: GPURenderPipeline | null = null;
  private blitBindGroupLayout: GPUBindGroupLayout | null = null;
  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private texW = 0;
  private texH = 0;
  private initialized = false;

  private constructor(device: GPUDevice) {
    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  static async create(): Promise<EffectsPipeline | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const pipeline = new EffectsPipeline(device);
      await pipeline.createPipelines();
      return pipeline;
    } catch {
      return null;
    }
  }

  private async createPipelines(): Promise<void> {
    if (this.initialized) return;

    // Create blit (passthrough) pipeline for final canvas output
    this.createBlitPipeline();

    for (const [id, effect] of GPU_EFFECT_REGISTRY) {
      this.createEffectPipeline(id, effect);
    }
    this.initialized = true;
  }

  private createBlitPipeline(): void {
    const module = this.device.createShaderModule({ label: 'blit', code: BLIT_SHADER });
    this.blitBindGroupLayout = this.device.createBindGroupLayout({
      label: 'blit-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    this.blitPipeline = this.device.createRenderPipeline({
      label: 'blit-pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blitBindGroupLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createEffectPipeline(id: string, effect: GpuEffectDefinition): void {
    try {
      const shaderCode = `${COMMON_WGSL}\n${effect.shader}`;
      const shaderModule = this.device.createShaderModule({ label: `effect-${id}`, code: shaderCode });

      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ];
      if (effect.uniformSize > 0) {
        entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      }

      const bindGroupLayout = this.device.createBindGroupLayout({ label: `effect-${id}-layout`, entries });
      this.bindGroupLayouts.set(id, bindGroupLayout);

      const pipeline = this.device.createRenderPipeline({
        label: `effect-${id}-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: shaderModule,
          entryPoint: effect.entryPoint,
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      });
      this.pipelines.set(id, pipeline);
    } catch (e) {
      console.warn(`Failed to create pipeline for ${id}`, e);
    }
  }

  private ensurePingPong(w: number, h: number): void {
    if (this.pingTexture && this.texW === w && this.texH === h) return;
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    const desc: GPUTextureDescriptor = {
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    };
    this.pingTexture = this.device.createTexture(desc);
    this.pongTexture = this.device.createTexture(desc);
    this.texW = w;
    this.texH = h;
  }

  private runEffectChain(
    commandEncoder: GPUCommandEncoder,
    effects: GpuEffectInstance[],
    startInput: GPUTexture,
    startOutput: GPUTexture,
    w: number,
    h: number,
  ): GPUTexture {
    let inputTex = startInput;
    let outputTex = startOutput;

    for (const effect of effects) {
      const pipeline = this.pipelines.get(effect.type);
      const layout = this.bindGroupLayouts.get(effect.type);
      if (!pipeline || !layout) continue;

      const definition = getGpuEffect(effect.type);
      if (!definition) continue;

      const uniformData = definition.packUniforms(effect.params, w, h);
      let uniformBuffer: GPUBuffer | undefined;
      if (uniformData) {
        uniformBuffer = this.device.createBuffer({
          size: uniformData.byteLength,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer);
      }

      const bindEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: inputTex.createView() },
      ];
      if (uniformBuffer) {
        bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } });
      }

      const bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: outputTex.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      const temp = inputTex;
      inputTex = outputTex;
      outputTex = temp;
    }

    return inputTex;
  }

  configureCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): GPUCanvasContext | null {
    try {
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * Process a source canvas through an effect chain and render to output canvas context.
   */
  applyEffects(
    source: OffscreenCanvas | HTMLCanvasElement,
    effects: GpuEffectInstance[],
    outputCtx: GPUCanvasContext,
  ): boolean {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return false;
    if (!this.blitPipeline || !this.blitBindGroupLayout) return false;

    const w = source.width;
    const h = source.height;
    if (w < 2 || h < 2) return false;

    this.ensurePingPong(w, h);
    if (!this.pingTexture || !this.pongTexture) return false;

    // Upload source to ping texture
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.pingTexture },
      { width: w, height: h },
    );

    const commandEncoder = this.device.createCommandEncoder();

    // Run effect chain
    const finalTex = this.runEffectChain(
      commandEncoder, enabled, this.pingTexture, this.pongTexture, w, h,
    );

    // Blit final result to output canvas via passthrough shader
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: finalTex.createView() },
      ],
    });

    const outputPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outputCtx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    outputPass.setPipeline(this.blitPipeline);
    outputPass.setBindGroup(0, blitBindGroup);
    outputPass.draw(6);
    outputPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    return true;
  }

  /**
   * Apply effects chain and return result as ImageData (for export pipeline).
   */
  async applyEffectsToImageData(
    imageData: ImageData,
    effects: GpuEffectInstance[],
  ): Promise<ImageData> {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return imageData;

    const w = imageData.width;
    const h = imageData.height;
    this.ensurePingPong(w, h);
    if (!this.pingTexture || !this.pongTexture) return imageData;

    // Upload ImageData to ping texture
    this.device.queue.writeTexture(
      { texture: this.pingTexture },
      imageData.data,
      { bytesPerRow: w * 4 },
      { width: w, height: h },
    );

    const commandEncoder = this.device.createCommandEncoder();

    const finalTex = this.runEffectChain(
      commandEncoder, enabled, this.pingTexture, this.pongTexture, w, h,
    );

    // Read back result
    const bytesPerRow = Math.ceil(w * 4 / 256) * 256; // align to 256
    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    commandEncoder.copyTextureToBuffer(
      { texture: finalTex },
      { buffer: readBuffer, bytesPerRow },
      { width: w, height: h },
    );

    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readBuffer.getMappedRange());

    // Copy with row stride handling
    const resultData = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      resultData.set(
        mapped.subarray(row * bytesPerRow, row * bytesPerRow + w * 4),
        row * w * 4,
      );
    }
    readBuffer.unmap();
    readBuffer.destroy();

    return new ImageData(resultData, w, h);
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  getFormat(): GPUTextureFormat {
    return this.format;
  }

  destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.pingTexture = null;
    this.pongTexture = null;
    this.pipelines.clear();
    this.bindGroupLayouts.clear();
    this.blitPipeline = null;
    this.blitBindGroupLayout = null;
    this.initialized = false;
  }
}
