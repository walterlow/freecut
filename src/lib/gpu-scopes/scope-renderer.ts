/**
 * GPU scope renderer facade.
 * Manages WebGPU device, source texture upload, and delegates to individual scope classes.
 */

import { HistogramScope } from './histogram-scope';
import { WaveformScope } from './waveform-scope';
import { VectorscopeScope } from './vectorscope-scope';

export class ScopeRenderer {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private histogram: HistogramScope;
  private waveform: WaveformScope;
  private vectorscope: VectorscopeScope;
  private srcTexture: GPUTexture | null = null;
  private srcW = 0;
  private srcH = 0;
  private kr = 0.2126;
  private kb = 0.0722;
  private rangeMin = 0;
  private rangeMax = 1;

  private constructor(device: GPUDevice) {
    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.histogram = new HistogramScope(device, this.format);
    this.waveform = new WaveformScope(device, this.format);
    this.vectorscope = new VectorscopeScope(device, this.format);
  }

  static async create(): Promise<ScopeRenderer | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      return new ScopeRenderer(device);
    } catch {
      return null;
    }
  }

  configureCanvas(canvas: HTMLCanvasElement): GPUCanvasContext | null {
    try {
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
      return ctx;
    } catch {
      return null;
    }
  }

  setMatrix(kr: number, kb: number) {
    this.kr = kr;
    this.kb = kb;
  }

  setRange(min: number, max: number) {
    this.rangeMin = min;
    this.rangeMax = max;
  }

  private ensureTexture(w: number, h: number) {
    if (this.srcTexture && this.srcW === w && this.srcH === h) return;
    this.srcTexture?.destroy();
    this.srcTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.srcW = w;
    this.srcH = h;
  }

  /** Near-zero-copy: GPU-accelerated transfer from canvas (avoids getImageData CPU readback) */
  uploadFromCanvas(source: OffscreenCanvas | HTMLCanvasElement) {
    const w = source.width;
    const h = source.height;
    if (w < 2 || h < 2) return;
    this.ensureTexture(w, h);
    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.srcTexture!, mipLevel: 0 },
      { width: w, height: h },
    );
  }

  /** Fallback: upload from ImageData (CPU → GPU transfer) */
  uploadFrame(imageData: ImageData) {
    const w = imageData.width;
    const h = imageData.height;
    this.ensureTexture(w, h);
    this.device.queue.writeTexture(
      { texture: this.srcTexture! },
      imageData.data,
      { bytesPerRow: w * 4 },
      { width: w, height: h },
    );
  }

  renderWaveform(ctx: GPUCanvasContext, mode: number) {
    if (!this.srcTexture) return;
    this.waveform.renderBatch(
      this.srcTexture,
      [{ ctx, mode }],
      this.kr,
      this.kb,
      this.rangeMin,
      this.rangeMax,
    );
  }

  renderWaveforms(requests: Array<{ ctx: GPUCanvasContext; mode: number }>) {
    if (!this.srcTexture || requests.length === 0) return;
    this.waveform.renderBatch(this.srcTexture, requests, this.kr, this.kb, this.rangeMin, this.rangeMax);
  }

  renderHistogram(ctx: GPUCanvasContext, mode: number) {
    if (!this.srcTexture) return;
    this.histogram.render(this.srcTexture, ctx, mode, this.kr, this.kb, this.rangeMin, this.rangeMax);
  }

  renderVectorscope(ctx: GPUCanvasContext) {
    if (!this.srcTexture) return;
    this.vectorscope.render(this.srcTexture, ctx, this.kr, this.kb);
  }

  clearScope(ctx: GPUCanvasContext) {
    try {
      const enc = this.device.createCommandEncoder();
      enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.04, g: 0.04, b: 0.04, a: 1 },
        }],
      }).end();
      this.device.queue.submit([enc.finish()]);
    } catch {
      // GPU error — ignore
    }
  }

  destroy() {
    this.srcTexture?.destroy();
    this.srcTexture = null;
    this.waveform.destroy();
    this.histogram.destroy();
    this.vectorscope.destroy();
  }
}
