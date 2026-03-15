import { createLogger } from '@/shared/logging/logger';
import { COMMON_WGSL } from './common';
import type { GpuEffectDefinition, GpuEffectInstance } from './types';
import { GPU_EFFECT_REGISTRY, getGpuEffect } from './index';

const logger = createLogger('EffectsPipeline');

const FULLSCREEN_VERTEX = /* wgsl */ `
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
`;

const BLIT_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}
`;

/**
 * Shader for importing an external video texture (texture_external) into the
 * ping texture with positioning. Uses importExternalTexture for zero-copy
 * GPU access to the video decoder's output buffer.
 *
 * destRect uniform: (left, top, right, bottom) in UV space [0..1].
 * Pixels outside the rect are transparent; pixels inside sample the video.
 */
const IMPORT_EXTERNAL_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var videoTex: texture_external;
@group(0) @binding(2) var<uniform> destRect: vec4f;
@fragment
fn importFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let r = destRect;
  if (uv.x < r.x || uv.x > r.z || uv.y < r.y || uv.y > r.w) {
    return vec4f(0.0);
  }
  let videoUv = (uv - r.xy) / (r.zw - r.xy);
  return textureSampleBaseClampToEdge(videoTex, texSampler, videoUv);
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
  // importExternalTexture pipeline for zero-copy video → GPU
  private importPipeline: GPURenderPipeline | null = null;
  private importBindGroupLayout: GPUBindGroupLayout | null = null;
  private importUniformBuffer: GPUBuffer | null = null;
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
  // Cached bind groups keyed by "effectId:ping|pong" — invalidated when textures change
  private effectBindGroupCache = new Map<string, GPUBindGroup>();
  // Cached blit bind groups for ping/pong input views
  private blitBindGroupPing: GPUBindGroup | null = null;
  private blitBindGroupPong: GPUBindGroup | null = null;
  // GPU backpressure: count of frames still in-flight on the GPU queue
  private gpuFramesInFlight = 0;
  private static MAX_FRAMES_IN_FLIGHT = 2;
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
    this.createImportExternalPipeline();

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

  private createImportExternalPipeline(): void {
    try {
      const module = this.device.createShaderModule({ label: 'import-external', code: IMPORT_EXTERNAL_SHADER });
      this.importBindGroupLayout = this.device.createBindGroupLayout({
        label: 'import-external-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      });
      this.importPipeline = this.device.createRenderPipeline({
        label: 'import-external-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.importBindGroupLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'importFragment', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      this.importUniformBuffer = this.device.createBuffer({
        size: 16, // vec4f = 4 floats × 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    } catch {
      // importExternalTexture may not be supported — fall back to copyExternalImageToTexture path
      this.importPipeline = null;
      this.importBindGroupLayout = null;
      this.importUniformBuffer = null;
    }
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
      logger.warn(`Failed to create pipeline for ${id}`, e);
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
    // Invalidate bind group caches — they reference old texture views
    this.effectBindGroupCache.clear();
    this.blitBindGroupPing = null;
    this.blitBindGroupPong = null;
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

      // Cache bind groups keyed by effect type + input view identity.
      // Uniform buffer data changes via writeBuffer but the buffer object stays the same,
      // so the bind group remains valid across frames.
      const viewKey = inputView === this.pingView ? 'ping' : 'pong';
      const cacheKey = `${effect.type}:${viewKey}`;
      let bindGroup = this.effectBindGroupCache.get(cacheKey);
      if (!bindGroup) {
        const bindEntries: GPUBindGroupEntry[] = [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: inputView },
        ];
        if (uniformBuffer) {
          bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } });
        }
        bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });
        this.effectBindGroupCache.set(cacheKey, bindGroup);
      }

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
   * Accepts HTMLVideoElement for zero-copy GPU capture
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

    // Backpressure: skip if too many frames are already in-flight on the GPU
    if (this.gpuFramesInFlight >= EffectsPipeline.MAX_FRAMES_IN_FLIGHT) return false;

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

    // Blit final result to output canvas (cached bind group for ping/pong input)
    const isPingFinal = finalTex === this.pingTexture;
    const blitBindGroup = isPingFinal
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }));

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

    // Track GPU completion — allow up to MAX_FRAMES_IN_FLIGHT concurrent frames
    this.gpuFramesInFlight++;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.gpuFramesInFlight = Math.max(0, this.gpuFramesInFlight - 1);
    }, () => {
      this.gpuFramesInFlight = Math.max(0, this.gpuFramesInFlight - 1);
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
    source: OffscreenCanvas | HTMLCanvasElement | HTMLVideoElement,
    effects: GpuEffectInstance[],
  ): OffscreenCanvas | null {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return null;
    if (!this.blitPipeline || !this.blitBindGroupLayout) return null;

    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
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

    // Blit to output canvas (cached bind group for ping/pong input)
    const isPingFinal = finalTex === this.pingTexture;
    const blitBindGroup = isPingFinal
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }));

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

  /**
   * Apply effects directly from an HTMLVideoElement via importExternalTexture.
   * Zero-copy: the GPU reads directly from the video decoder's output buffer.
   * Positions the video at `destRect` on a canvas of `canvasWidth × canvasHeight`.
   *
   * Falls back to null if importExternalTexture is not supported or fails.
   */
  applyEffectsToVideo(
    video: HTMLVideoElement,
    effects: GpuEffectInstance[],
    destRect: { x: number; y: number; width: number; height: number },
    canvasWidth: number,
    canvasHeight: number,
  ): OffscreenCanvas | null {
    const enabled = effects.filter(e => e.enabled);
    if (enabled.length === 0) return null;
    if (!this.importPipeline || !this.importBindGroupLayout || !this.importUniformBuffer) return null;
    if (!this.blitPipeline || !this.blitBindGroupLayout) return null;
    if (video.readyState < 2 || video.videoWidth < 2) return null;

    const w = canvasWidth;
    const h = canvasHeight;
    if (w < 2 || h < 2) return null;

    // Get output canvas
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

    // Import video as external texture (truly zero-copy — no pixel transfer)
    let externalTexture: GPUExternalTexture;
    try {
      externalTexture = this.device.importExternalTexture({ source: video });
    } catch {
      return null; // importExternalTexture failed — caller should fall back
    }

    // Compute destination rect in UV space [0..1]
    const uvRect = new Float32Array([
      destRect.x / w,
      destRect.y / h,
      (destRect.x + destRect.width) / w,
      (destRect.y + destRect.height) / h,
    ]);
    this.device.queue.writeBuffer(this.importUniformBuffer, 0, uvRect.buffer);

    const commandEncoder = this.device.createCommandEncoder();

    // Pass 1: Import external texture → ping texture (with positioning)
    const importBindGroup = this.device.createBindGroup({
      layout: this.importBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: externalTexture },
        { binding: 2, resource: { buffer: this.importUniformBuffer } },
      ],
    });

    const importPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.pingView!,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    importPass.setPipeline(this.importPipeline);
    importPass.setBindGroup(0, importBindGroup);
    importPass.draw(6);
    importPass.end();

    // Pass 2+: Effect chain (ping/pong as usual)
    const finalTex = this.runEffectChain(
      commandEncoder, enabled, this.pingTexture, this.pongTexture, w, h,
    );

    // Final blit to output canvas (cached bind group for ping/pong input)
    const isPingFinal = finalTex === this.pingTexture;
    const blitBindGroup = isPingFinal
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitBindGroupLayout!,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }));

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
    this.effectBindGroupCache.clear();
    this.blitBindGroupPing = null;
    this.blitBindGroupPong = null;
    this.gpuFramesInFlight = 0;
    this.pipelines.clear();
    this.bindGroupLayouts.clear();
    this.blitPipeline = null;
    this.blitBindGroupLayout = null;
    this.importPipeline = null;
    this.importBindGroupLayout = null;
    this.importUniformBuffer?.destroy();
    this.importUniformBuffer = null;
    this.initialized = false;
  }
}
