import { createLogger } from '@/shared/logging/logger';
import { COMMON_WGSL } from './common';
import type { GpuEffectDefinition, GpuEffectInstance } from './types';
import { GPU_EFFECT_REGISTRY, getGpuEffect } from './index';

function getLogger() { return createLogger('EffectsPipeline'); }

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
 * mediaRect uniform: (left, top, right, bottom) in UV space [0..1].
 * visibleRect uniform: cropped visible region in UV space [0..1].
 * featherInsets uniform: left/right/top/bottom feather widths in UV space.
 * Pixels outside the visible rect are transparent; pixels inside sample the
 * video using mediaRect for placement so crop does not rescale the content.
 * Feathered crop edges fade alpha inside visibleRect without stretching.
 */
const IMPORT_EXTERNAL_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct ImportUniforms {
  mediaRect: vec4f,
  visibleRect: vec4f,
  featherInsets: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var videoTex: texture_external;
@group(0) @binding(2) var<uniform> u: ImportUniforms;
@fragment
fn importFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv;
  let mediaRect = u.mediaRect;
  let visibleRect = u.visibleRect;
  let featherInsets = u.featherInsets;
  let mediaSize = max(mediaRect.zw - mediaRect.xy, vec2f(0.0001, 0.0001));
  let rawVideoUv = (uv - mediaRect.xy) / mediaSize;
  let videoUv = clamp(rawVideoUv, vec2f(0.0), vec2f(1.0));
  let inMedia = uv.x >= mediaRect.x && uv.x <= mediaRect.z && uv.y >= mediaRect.y && uv.y <= mediaRect.w;
  let inVisible = uv.x >= visibleRect.x && uv.x <= visibleRect.z && uv.y >= visibleRect.y && uv.y <= visibleRect.w;
  var featherMask = 1.0;
  if (featherInsets.x > 0.0) {
    featherMask = featherMask * smoothstep(visibleRect.x, min(visibleRect.x + featherInsets.x, visibleRect.z), uv.x);
  }
  if (featherInsets.y > 0.0) {
    featherMask = featherMask * (1.0 - smoothstep(max(visibleRect.z - featherInsets.y, visibleRect.x), visibleRect.z, uv.x));
  }
  if (featherInsets.z > 0.0) {
    featherMask = featherMask * smoothstep(visibleRect.y, min(visibleRect.y + featherInsets.z, visibleRect.w), uv.y);
  }
  if (featherInsets.w > 0.0) {
    featherMask = featherMask * (1.0 - smoothstep(max(visibleRect.w - featherInsets.w, visibleRect.y), visibleRect.w, uv.y));
  }
  let visibleMask = select(0.0, featherMask, inMedia && inVisible);
  return textureSampleBaseClampToEdge(videoTex, texSampler, videoUv) * visibleMask;
}
`;

const IMPORT_UNIFORM_BYTE_SIZE = 48;

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

  // Cached GPU device — requesting a WebGPU adapter + device is the most
  // expensive single operation (~50-100ms). Cache it so subsequent
  // EffectsPipeline instances skip the device request entirely.
  private static _cachedDevice: GPUDevice | null = null;
  private static _devicePromise: Promise<GPUDevice | null> | null = null;

  static async requestCachedDevice(): Promise<GPUDevice | null> {
    if (EffectsPipeline._cachedDevice) return EffectsPipeline._cachedDevice;
    if (EffectsPipeline._devicePromise) return EffectsPipeline._devicePromise;
    EffectsPipeline._devicePromise = (async () => {
      if (typeof navigator === 'undefined' || !navigator.gpu) return null;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        const device = await adapter.requestDevice();
        EffectsPipeline._cachedDevice = device;
        device.lost.then(() => {
          if (EffectsPipeline._cachedDevice === device) {
            EffectsPipeline._cachedDevice = null;
          }
        });
        return device;
      } catch {
        return null;
      } finally {
        EffectsPipeline._devicePromise = null;
      }
    })();
    return EffectsPipeline._devicePromise;
  }

  static async create(): Promise<EffectsPipeline | null> {
    const device = await EffectsPipeline.requestCachedDevice();
    if (!device) return null;
    try {
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
      if (this.importUniformBuffer.size !== IMPORT_UNIFORM_BYTE_SIZE) {
        this.importUniformBuffer.destroy();
        this.importUniformBuffer = this.device.createBuffer({
          size: IMPORT_UNIFORM_BYTE_SIZE,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      }
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
      getLogger().warn(`Failed to create pipeline for ${id}`, e);
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
   * Positions the video using `mediaRect` and `visibleRect` on a canvas of
   * `canvasWidth × canvasHeight`.
   *
   * Falls back to null if importExternalTexture is not supported or fails.
   */
  private renderImportedVideo(
    video: HTMLVideoElement,
    enabledEffects: GpuEffectInstance[],
    mediaRect: { x: number; y: number; width: number; height: number },
    visibleRect: { x: number; y: number; width: number; height: number },
    featherInsets: { left: number; right: number; top: number; bottom: number },
    canvasWidth: number,
    canvasHeight: number,
  ): OffscreenCanvas | null {
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

    const importUniforms = new Float32Array([
      mediaRect.x / w,
      mediaRect.y / h,
      (mediaRect.x + mediaRect.width) / w,
      (mediaRect.y + mediaRect.height) / h,
      visibleRect.x / w,
      visibleRect.y / h,
      (visibleRect.x + visibleRect.width) / w,
      (visibleRect.y + visibleRect.height) / h,
      featherInsets.left / w,
      featherInsets.right / w,
      featherInsets.top / h,
      featherInsets.bottom / h,
    ]);
    this.device.queue.writeBuffer(this.importUniformBuffer, 0, importUniforms.buffer);

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

    const finalTex = enabledEffects.length > 0
      ? this.runEffectChain(
        commandEncoder, enabledEffects, this.pingTexture, this.pongTexture, w, h,
      )
      : this.pingTexture;

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

  /**
   * Draw an HTMLVideoElement directly to a GPU canvas via importExternalTexture.
   * Zero-copy: the GPU samples the decoder output without an intermediate upload.
   */
  renderVideoToCanvas(
    video: HTMLVideoElement,
    mediaRect: { x: number; y: number; width: number; height: number },
    visibleRect: { x: number; y: number; width: number; height: number },
    featherInsets: { left: number; right: number; top: number; bottom: number },
    canvasWidth: number,
    canvasHeight: number,
  ): OffscreenCanvas | null {
    return this.renderImportedVideo(video, [], mediaRect, visibleRect, featherInsets, canvasWidth, canvasHeight);
  }

  /**
   * Apply effects directly from an HTMLVideoElement via importExternalTexture.
   * Zero-copy: the GPU reads directly from the video decoder's output buffer.
   * Positions the video using `mediaRect` and `visibleRect` on a canvas of
   * `canvasWidth × canvasHeight`.
   *
   * Falls back to null if importExternalTexture is not supported or fails.
   */
  applyEffectsToVideo(
    video: HTMLVideoElement,
    effects: GpuEffectInstance[],
    mediaRect: { x: number; y: number; width: number; height: number },
    visibleRect: { x: number; y: number; width: number; height: number },
    featherInsets: { left: number; right: number; top: number; bottom: number },
    canvasWidth: number,
    canvasHeight: number,
  ): OffscreenCanvas | null {
    const enabled = effects.filter(e => e.enabled);
    return this.renderImportedVideo(video, enabled, mediaRect, visibleRect, featherInsets, canvasWidth, canvasHeight);
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
