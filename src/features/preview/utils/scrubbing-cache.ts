/**
 * 3-Tier Scrubbing Cache
 *
 * Tier 1 (VRAM): GPUTexture cache for instant scrub — cache hits avoid CPU→GPU
 *   upload entirely, just blit from cached texture to output.
 * Tier 2 (RAM): Per-video last-frame cache — when seeking between clips, the
 *   last decoded frame shows instantly without waiting for mediabunny decode.
 * Tier 3 (RAM): Deep frame buffer with LRU eviction — stores composited frames
 *   as ImageBitmaps. On access, promotes to Tier 1 if GPU is available.
 *
 * When all tiers are warm, scrubbing doesn't decode at all.
 */

// ---------------------------------------------------------------------------
// Tier 1 — VRAM GPU Texture Cache
// ---------------------------------------------------------------------------

interface GpuCacheEntry {
  texture: GPUTexture;
  view: GPUTextureView;
}

class GpuTextureCache {
  private cache = new Map<number, GpuCacheEntry>();
  private maxFrames: number;
  private device: GPUDevice | null = null;
  private texW = 0;
  private texH = 0;

  constructor(maxFrames: number) {
    this.maxFrames = maxFrames;
  }

  setDevice(device: GPUDevice, width: number, height: number): void {
    if (this.device === device && this.texW === width && this.texH === height) return;
    // Device or dimensions changed — flush
    this.clear();
    this.device = device;
    this.texW = width;
    this.texH = height;
    // Adaptive VRAM budget based on detected device memory.
    // navigator.deviceMemory (GB, rounded) is available in Chromium — use as proxy
    // for GPU memory on integrated GPUs. Fall back to conservative 500MB.
    const deviceMemoryGb = (navigator as { deviceMemory?: number }).deviceMemory;
    const vramBudgetBytes = deviceMemoryGb !== undefined
      ? Math.min(deviceMemoryGb * 0.125, 1) * 1_000_000_000 // 12.5% of system RAM, max 1GB
      : 500_000_000; // conservative default (~500MB)
    const bytesPerFrame = width * height * 4;
    this.maxFrames = Math.min(this.maxFrames, Math.floor(vramBudgetBytes / bytesPerFrame));
  }

  get(frame: number): GpuCacheEntry | undefined {
    const entry = this.cache.get(frame);
    if (!entry) return undefined;
    // LRU touch: delete + re-insert moves to end
    this.cache.delete(frame);
    this.cache.set(frame, entry);
    return entry;
  }

  put(frame: number, source: ImageBitmap | OffscreenCanvas): GpuCacheEntry | null {
    if (!this.device || this.texW < 2 || this.texH < 2) return null;

    // Already cached
    if (this.cache.has(frame)) {
      return this.cache.get(frame)!;
    }

    // Evict LRU if full
    if (this.cache.size >= this.maxFrames) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        const old = this.cache.get(oldest);
        old?.texture.destroy();
        this.cache.delete(oldest);
      }
    }

    try {
      const texture = this.device.createTexture({
        size: { width: this.texW, height: this.texH },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture },
        { width: this.texW, height: this.texH },
      );
      const view = texture.createView();
      const entry: GpuCacheEntry = { texture, view };
      this.cache.set(frame, entry);
      return entry;
    } catch {
      return null;
    }
  }

  has(frame: number): boolean {
    return this.cache.has(frame);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy();
    }
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — Per-Video Last-Frame Cache
// ---------------------------------------------------------------------------

export type Tier2VideoFrame = ImageBitmap | VideoFrame;

export interface VideoFrameEntry {
  frame: Tier2VideoFrame;
  sourceTime: number;
}

class VideoFrameCache {
  private cache = new Map<string, VideoFrameEntry>();

  get(itemId: string): VideoFrameEntry | undefined {
    return this.cache.get(itemId);
  }

  put(itemId: string, frame: Tier2VideoFrame, sourceTime: number): void {
    const old = this.cache.get(itemId);
    if (old) old.frame.close();
    this.cache.set(itemId, { frame, sourceTime });
  }

  has(itemId: string): boolean {
    return this.cache.has(itemId);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      entry.frame.close();
    }
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — RAM Preview (Deep ImageBitmap Buffer)
// ---------------------------------------------------------------------------

class RamPreviewCache {
  private cache = new Map<number, ImageBitmap>();
  private maxFrames: number;
  private maxBytes: number;
  private currentBytes = 0;
  private bytesPerFrame = 0;

  constructor(maxFrames: number, maxBytes: number) {
    this.maxFrames = maxFrames;
    this.maxBytes = maxBytes;
  }

  setDimensions(width: number, height: number): void {
    this.bytesPerFrame = width * height * 4;
  }

  get(frame: number): ImageBitmap | undefined {
    const bitmap = this.cache.get(frame);
    if (!bitmap) return undefined;
    // LRU touch
    this.cache.delete(frame);
    this.cache.set(frame, bitmap);
    return bitmap;
  }

  put(frame: number, bitmap: ImageBitmap): void {
    if (this.cache.has(frame)) {
      bitmap.close();
      return;
    }

    // Evict until within both limits
    while (
      (this.cache.size >= this.maxFrames || this.currentBytes + this.bytesPerFrame > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const old = this.cache.get(oldest)!;
      old.close();
      this.cache.delete(oldest);
      this.currentBytes -= this.bytesPerFrame;
    }

    this.cache.set(frame, bitmap);
    this.currentBytes += this.bytesPerFrame;
  }

  has(frame: number): boolean {
    return this.cache.has(frame);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    for (const bitmap of this.cache.values()) {
      bitmap.close();
    }
    this.cache.clear();
    this.currentBytes = 0;
  }
}

// ---------------------------------------------------------------------------
// ScrubbingCache — Unified 3-Tier Interface
// ---------------------------------------------------------------------------

export interface ScrubbingCacheStats {
  tier1Size: number;
  tier2Size: number;
  tier3Size: number;
  tier1Hits: number;
  tier2Hits: number;
  tier3Hits: number;
  misses: number;
}

export class ScrubbingCache {
  private tier1: GpuTextureCache;
  private tier2: VideoFrameCache;
  private tier3: RamPreviewCache;

  // Stats
  private _tier1Hits = 0;
  private _tier2Hits = 0;
  private _tier3Hits = 0;
  private _misses = 0;

  // GPU blit resources (for Tier 1 cache hit rendering)
  private blitPipeline: GPURenderPipeline | null = null;
  private blitBindGroupLayout: GPUBindGroupLayout | null = null;
  private blitSampler: GPUSampler | null = null;
  private blitCanvas: OffscreenCanvas | null = null;
  private blitCtx: GPUCanvasContext | null = null;
  private blitDevice: GPUDevice | null = null;
  private blitFormat: GPUTextureFormat = 'rgba8unorm';
  private blitW = 0;
  private blitH = 0;

  constructor(
    maxGpuFrames = 300,
    maxRamFrames = 900,
    maxRamBytes = 8_000_000_000, // ~8GB — allows 900 frames at 1080p (~8MB each)
  ) {
    this.tier1 = new GpuTextureCache(maxGpuFrames);
    this.tier2 = new VideoFrameCache();
    this.tier3 = new RamPreviewCache(maxRamFrames, maxRamBytes);
  }

  /**
   * Connect the GPU device (deferred — called after EffectsPipeline initializes).
   * Enables Tier 1 caching and GPU blit for cache hits.
   */
  setGpuDevice(device: GPUDevice, width: number, height: number): void {
    this.tier1.setDevice(device, width, height);
    this.tier3.setDimensions(width, height);

    if (this.blitDevice !== device) {
      this.blitDevice = device;
      this.blitFormat = navigator.gpu.getPreferredCanvasFormat();
      this.blitSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this.initBlitPipeline(device);
    }

    if (this.blitW !== width || this.blitH !== height) {
      this.blitW = width;
      this.blitH = height;
      this.blitCanvas = null;
      this.blitCtx = null;
    }
  }

  // -----------------------------------------------------------------------
  // Tier 1 — VRAM texture cache
  // -----------------------------------------------------------------------

  /** Check Tier 1 GPU cache. Returns an OffscreenCanvas with the frame if hit. */
  getGpuFrame(frame: number): OffscreenCanvas | null {
    const entry = this.tier1.get(frame);
    if (!entry) return null;

    const canvas = this.blitToCanvas(entry.view);
    if (canvas) {
      this._tier1Hits++;
      return canvas;
    }
    return null;
  }

  /** Upload a composited frame to Tier 1 GPU cache. */
  putGpuFrame(frame: number, source: ImageBitmap | OffscreenCanvas): void {
    this.tier1.put(frame, source);
  }

  // -----------------------------------------------------------------------
  // Tier 2 — Per-video last-frame cache
  // -----------------------------------------------------------------------

  /** Get the last decoded frame for a video item (for instant clip-boundary display). */
  getVideoFrameEntry(
    itemId: string,
    sourceTime?: number,
    maxSourceTimeDelta = Number.POSITIVE_INFINITY,
  ): VideoFrameEntry | undefined {
    const entry = this.tier2.get(itemId);
    if (!entry) {
      return undefined;
    }
    if (
      sourceTime !== undefined
      && Math.abs(entry.sourceTime - sourceTime) > maxSourceTimeDelta
    ) {
      return undefined;
    }
    this._tier2Hits++;
    return entry;
  }

  /** Cache a decoded video frame for a specific item. */
  putVideoFrame(itemId: string, frame: Tier2VideoFrame, sourceTime: number): void {
    this.tier2.put(itemId, frame, sourceTime);
  }

  // -----------------------------------------------------------------------
  // Tier 3 — RAM Preview (deep ImageBitmap buffer)
  // -----------------------------------------------------------------------

  /** Check Tier 3 RAM cache. Returns ImageBitmap if hit. */
  getRamFrame(frame: number): ImageBitmap | undefined {
    const bitmap = this.tier3.get(frame);
    if (bitmap) {
      this._tier3Hits++;
      // Promote to Tier 1 on access
      this.tier1.put(frame, bitmap);
      return bitmap;
    }
    return undefined;
  }

  /** Store a composited frame in Tier 3 RAM cache. */
  putRamFrame(frame: number, bitmap: ImageBitmap): void {
    this.tier3.put(frame, bitmap);
  }

  // -----------------------------------------------------------------------
  // Unified lookup (Tier 1 → Tier 3 → miss)
  // -----------------------------------------------------------------------

  /**
   * Try all tiers. Returns an ImageBitmap or OffscreenCanvas on hit, null on miss.
   * Tier 2 (per-video) is NOT checked here — it's item-level, not frame-level.
   */
  getFrame(frame: number): ImageBitmap | OffscreenCanvas | null {
    // Tier 1 — GPU texture (fastest: ~0.1ms blit)
    const gpuResult = this.getGpuFrame(frame);
    if (gpuResult) return gpuResult;

    // Tier 3 — RAM ImageBitmap (promotes to Tier 1 on access)
    const ramResult = this.getRamFrame(frame);
    if (ramResult) return ramResult;

    this._misses++;
    return null;
  }

  /**
   * Cache a fully composited frame into Tier 1 + Tier 3.
   * Call after renderFrame() completes.
   *
   * Tier 1 (GPU) is populated synchronously from the canvas via
   * copyExternalImageToTexture — no bitmap creation needed (<1ms).
   * Tier 3 (RAM) uses async createImageBitmap in the background.
   * The source canvas is NOT modified — safe for display canvases.
   */
  cacheFrame(frame: number, canvas: OffscreenCanvas): void {
    // Tier 1: GPU upload directly from canvas (synchronous, no bitmap copy)
    if (!this.tier1.has(frame)) {
      this.tier1.put(frame, canvas);
    }

    // Tier 3: RAM buffer (async bitmap creation in background)
    if (!this.tier3.has(frame)) {
      createImageBitmap(canvas).then(
        (bitmap) => {
          if (!this.tier3.has(frame)) {
            this.tier3.put(frame, bitmap);
          } else {
            bitmap.close();
          }
        },
        () => { /* canvas may be zero-size or detached */ }
      );
    }
  }

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  /** Evict specific frames or flush all tiers. */
  invalidate(frames?: number[]): void {
    if (!frames) {
      this.tier1.clear();
      this.tier3.clear();
      return;
    }
    // Selective invalidation is expensive for GPU textures — flush all tiers
    this.tier1.clear();
    this.tier3.clear();
  }

  /** Clear Tier 2 (per-video last-frame). Call when timeline items change. */
  invalidateVideoFrames(): void {
    this.tier2.clear();
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  getStats(): ScrubbingCacheStats {
    return {
      tier1Size: this.tier1.size,
      tier2Size: this.tier2.size,
      tier3Size: this.tier3.size,
      tier1Hits: this._tier1Hits,
      tier2Hits: this._tier2Hits,
      tier3Hits: this._tier3Hits,
      misses: this._misses,
    };
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  dispose(): void {
    this.tier1.clear();
    this.tier2.clear();
    this.tier3.clear();
    this.blitCanvas = null;
    this.blitCtx = null;
    this.blitPipeline = null;
    this.blitBindGroupLayout = null;
    this.blitSampler = null;
    this.blitDevice = null;
  }

  // -----------------------------------------------------------------------
  // GPU blit internals (Tier 1 cache hit → OffscreenCanvas)
  // -----------------------------------------------------------------------

  private initBlitPipeline(device: GPUDevice): void {
    const BLIT_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1)
  );
  var uv = array<vec2f, 6>(
    vec2f(0, 1), vec2f(1, 1), vec2f(0, 0),
    vec2f(0, 0), vec2f(1, 1), vec2f(1, 0)
  );
  var o: VertexOutput;
  o.position = vec4f(pos[vi], 0, 1);
  o.uv = uv[vi];
  return o;
}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}`;

    const module = device.createShaderModule({ label: 'scrub-cache-blit', code: BLIT_SHADER });
    this.blitBindGroupLayout = device.createBindGroupLayout({
      label: 'scrub-cache-blit-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    this.blitPipeline = device.createRenderPipeline({
      label: 'scrub-cache-blit-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.blitBindGroupLayout] }),
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.blitFormat }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  private blitToCanvas(textureView: GPUTextureView): OffscreenCanvas | null {
    if (!this.blitDevice || !this.blitPipeline || !this.blitBindGroupLayout || !this.blitSampler) {
      return null;
    }

    if (!this.blitCanvas || this.blitCanvas.width !== this.blitW || this.blitCanvas.height !== this.blitH) {
      this.blitCanvas = new OffscreenCanvas(this.blitW, this.blitH);
      const ctx = this.blitCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.blitDevice, format: this.blitFormat, alphaMode: 'premultiplied' });
      this.blitCtx = ctx;
    }
    if (!this.blitCtx) return null;

    const bindGroup = this.blitDevice.createBindGroup({
      layout: this.blitBindGroupLayout,
      entries: [
        { binding: 0, resource: this.blitSampler },
        { binding: 1, resource: textureView },
      ],
    });

    const encoder = this.blitDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.blitCtx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    this.blitDevice.queue.submit([encoder.finish()]);

    return this.blitCanvas;
  }
}
