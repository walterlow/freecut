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

  // Reusable uniform buffers per effect type (avoids per-frame allocation)
  private uniformBuffers = new Map<string, GPUBuffer>();
  // Cached texture views for ping/pong (recreated when textures change)
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
  // GPU backpressure: true while GPU is processing a frame
  private gpuBusy = false;
  // Reusable offscreen canvas for applyEffectsToCanvas output (non-batch)
  private outputCanvas: OffscreenCanvas | null = null;
  private outputCtx: GPUCanvasContext | null = null;
  private outputW = 0;
  private outputH = 0;
  // Pooled output mode: per-item output canvases for deferred compositing
  private poolMode = false;
  private outputPool: { canvas: OffscreenCanvas; ctx: GPUCanvasContext; w: number; h: number }[] = [];
  private batchIndex = 0;

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
    this.pingView = this.pingTexture.createView();
    this.pongView = this.pongTexture.createView();
    this.texW = w;
    this.texH = h;
  }

  private getOrCreateUniformBuffer(effectId: string, size: number): GPUBuffer {
    let buf = this.uniformBuffers.get(effectId);
    if (buf && buf.size >= size) return buf;
    buf?.destroy();
    buf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffers.set(effectId, buf);
    return buf;
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
    let inputView = inputTex === this.pingTexture ? this.pingView! : this.pongView!;
    let outputView = outputTex === this.pingTexture ? this.pingView! : this.pongView!;

    for (const effect of effects) {
      const pipeline = this.pipelines.get(effect.type);
      const layout = this.bindGroupLayouts.get(effect.type);
      if (!pipeline || !layout) continue;

      const definition = getGpuEffect(effect.type);
      if (!definition) continue;

      const uniformData = definition.packUniforms(effect.params, w, h);
      let uniformBuffer: GPUBuffer | undefined;
      if (uniformData) {
        uniformBuffer = this.getOrCreateUniformBuffer(effect.type, uniformData.byteLength);
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer);
      }

      const bindEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: inputView },
      ];
      if (uniformBuffer) {
        bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } });
      }

      const bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: outputView,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      const tempTex = inputTex;
      inputTex = outputTex;
      outputTex = tempTex;
      const tempView = inputView;
      inputView = outputView;
      outputView = tempView;
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
   * Process a source through an effect chain and render to output canvas context.
   * Accepts HTMLVideoElement for zero-copy GPU capture (like masterselects importExternalTexture).
   * Returns false if skipped (GPU busy or no effects).
   */
  applyEffects(
    source: OffscreenCanvas | HTMLCanvasElement | HTMLVideoElement,
    effects: GpuEffectInstance[],
    outputCtx: GPUCanvasContext,
  ): boolean {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return false;
    if (!this.blitPipeline || !this.blitBindGroupLayout) return false;

    // Backpressure: skip if GPU is still processing the previous frame
    if (this.gpuBusy) return false;

    // Get dimensions — HTMLVideoElement uses videoWidth/videoHeight
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
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

    // Blit final result to output canvas
    const finalView = finalTex === this.pingTexture ? this.pingView! : this.pongView!;
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: finalView },
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

    // Track GPU completion to prevent queue buildup
    this.gpuBusy = true;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.gpuBusy = false;
    });

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

  /**
   * Begin pooled output mode. Each applyEffectsToCanvas call gets its own
   * output canvas from a pool and submits immediately. This allows the GPU
   * to pipeline work across items. Callers should defer compositing
   * (drawImage) until all items are processed — the first drawImage stalls
   * for all preceding GPU work, subsequent ones are free.
   */
  beginBatch(): void {
    this.poolMode = true;
    this.batchIndex = 0;
  }

  /**
   * End pooled output mode. Reset pool index for next frame.
   */
  endBatch(): void {
    this.poolMode = false;
    this.batchIndex = 0;
  }

  isBatching(): boolean {
    return this.poolMode;
  }

  private acquirePooledOutput(w: number, h: number): { canvas: OffscreenCanvas; ctx: GPUCanvasContext } | null {
    let entry = this.outputPool[this.batchIndex];
    if (entry) {
      if (entry.w !== w || entry.h !== h) {
        entry.canvas.width = w;
        entry.canvas.height = h;
        const ctx = this.configureCanvas(entry.canvas);
        if (!ctx) return null;
        entry.ctx = ctx;
        entry.w = w;
        entry.h = h;
      }
    } else {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = this.configureCanvas(canvas);
      if (!ctx) return null;
      entry = { canvas, ctx, w, h };
      this.outputPool.push(entry);
    }
    this.batchIndex++;
    return entry;
  }

  /**
   * Apply effects to a canvas source and return a canvas with the result.
   * Zero-copy input via copyExternalImageToTexture, GPU-rendered output.
   *
   * In pool mode (beginBatch/endBatch): each call gets its own output canvas
   * from a pool and submits immediately. The GPU pipelines work across items.
   * Callers should defer compositing (drawImage) until all items are processed.
   *
   * Outside pool mode: uses a single reusable output canvas.
   */
  applyEffectsToCanvas(
    source: OffscreenCanvas | HTMLCanvasElement,
    effects: GpuEffectInstance[],
  ): OffscreenCanvas | null {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return null;
    if (!this.blitPipeline || !this.blitBindGroupLayout) return null;

    const w = source.width;
    const h = source.height;
    if (w < 2 || h < 2) return null;

    // Get output canvas — from pool in pool mode, reusable single otherwise
    let outCanvas: OffscreenCanvas;
    let outCtx: GPUCanvasContext;

    if (this.poolMode) {
      const entry = this.acquirePooledOutput(w, h);
      if (!entry) return null;
      outCanvas = entry.canvas;
      outCtx = entry.ctx;
    } else {
      if (!this.outputCanvas || this.outputW !== w || this.outputH !== h) {
        this.outputCanvas = new OffscreenCanvas(w, h);
        this.outputCtx = this.configureCanvas(this.outputCanvas);
        this.outputW = w;
        this.outputH = h;
      }
      if (!this.outputCtx) return null;
      outCanvas = this.outputCanvas;
      outCtx = this.outputCtx;
    }

    this.ensurePingPong(w, h);
    if (!this.pingTexture || !this.pongTexture) return null;

    // Upload source → GPU texture (zero-copy path, no ImageData)
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.pingTexture },
      { width: w, height: h },
    );

    const commandEncoder = this.device.createCommandEncoder();

    const finalTex = this.runEffectChain(
      commandEncoder, enabled, this.pingTexture, this.pongTexture, w, h,
    );

    // Blit to output canvas
    const finalView = finalTex === this.pingTexture ? this.pingView! : this.pongView!;
    const blitBindGroup = this.device.createBindGroup({
      layout: this.blitBindGroupLayout!,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: finalView },
      ],
    });

    const outputPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outCtx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    outputPass.setPipeline(this.blitPipeline!);
    outputPass.setBindGroup(0, blitBindGroup);
    outputPass.draw(6);
    outputPass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    return outCanvas;
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
    this.pingView = null;
    this.pongView = null;
    this.outputCanvas = null;
    this.outputCtx = null;
    this.outputW = 0;
    this.outputH = 0;
    this.poolMode = false;
    this.outputPool = [];
    this.batchIndex = 0;
    for (const buf of this.uniformBuffers.values()) {
      buf.destroy();
    }
    this.uniformBuffers.clear();
    this.pipelines.clear();
    this.bindGroupLayouts.clear();
    this.blitPipeline = null;
    this.blitBindGroupLayout = null;
    this.initialized = false;
  }
}
