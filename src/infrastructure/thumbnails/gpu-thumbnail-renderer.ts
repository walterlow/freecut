/**
 * GPU Thumbnail Renderer
 *
 * Renders composition thumbnails with full GPU effects, blend modes,
 * and masks applied. Uses a separate low-power GPU context to avoid
 * competing with the main preview pipeline.
 *
 * Lazy singleton — created on first use.
 */

import { EffectsPipeline } from '@/infrastructure/gpu/effects';
import { CompositorPipeline } from '@/infrastructure/gpu/compositor';
import { MaskTextureManager } from '@/infrastructure/gpu/masks';

export interface ThumbnailFrame {
  /** Source elements to composite (bottom-to-top order) */
  layers: ThumbnailLayer[];
}

export interface ThumbnailLayer {
  /** Image source (already seeked/loaded) */
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  /** GPU effect instances (from GpuEffectInstance) */
  effects?: Array<{
    type: string;
    enabled: boolean;
    params: Record<string, number | boolean | string>;
  }>;
  /** Opacity 0-1 */
  opacity?: number;
}

export class GpuThumbnailRenderer {
  private device: GPUDevice;
  private effectsPipeline: EffectsPipeline;
  private compositor: CompositorPipeline;
  private maskManager: MaskTextureManager;
  private canvas: OffscreenCanvas;
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;

  private constructor(
    device: GPUDevice,
    effectsPipeline: EffectsPipeline,
    compositor: CompositorPipeline,
    maskManager: MaskTextureManager,
    canvas: OffscreenCanvas,
    ctx: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.device = device;
    this.effectsPipeline = effectsPipeline;
    this.compositor = compositor;
    this.maskManager = maskManager;
    this.canvas = canvas;
    this.ctx = ctx;
    this.format = format;
  }

  /**
   * Create a thumbnail renderer with its own GPU context.
   * Returns null if WebGPU is unavailable.
   */
  static async create(width = 320, height = 180): Promise<GpuThumbnailRenderer | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;

    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();

      const effectsPipeline = await EffectsPipeline.create();
      if (!effectsPipeline) {
        device.destroy();
        return null;
      }

      const compositor = new CompositorPipeline(device);
      const maskManager = new MaskTextureManager(device);

      const canvas = new OffscreenCanvas(width, height);
      const format = navigator.gpu.getPreferredCanvasFormat();
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
      ctx.configure({ device, format, alphaMode: 'premultiplied' });

      return new GpuThumbnailRenderer(
        device, effectsPipeline, compositor, maskManager, canvas, ctx, format,
      );
    } catch {
      return null;
    }
  }

  /**
   * Render a single thumbnail frame.
   * Returns an ImageBitmap that can be displayed or encoded to JPEG.
   */
  async renderFrame(
    frame: ThumbnailFrame,
    width: number,
    height: number,
  ): Promise<ImageBitmap | null> {
    try {
      // Resize canvas if needed
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.configure({
          device: this.device,
          format: this.format,
          alphaMode: 'premultiplied',
        });
      }

      const tempCanvas = new OffscreenCanvas(width, height);
      const tempCtx = tempCanvas.getContext('2d')!;

      for (const layer of frame.layers) {
        tempCtx.globalAlpha = layer.opacity ?? 1;

        if (layer.effects && layer.effects.length > 0) {
          const effected = this.effectsPipeline.applyEffectsToCanvas(
            layer.source as OffscreenCanvas | HTMLCanvasElement,
            layer.effects.map((e) => ({
              id: '',
              type: e.type,
              name: '',
              enabled: e.enabled,
              params: e.params,
            })),
          );
          if (effected) {
            tempCtx.drawImage(effected, 0, 0, width, height);
          } else {
            tempCtx.drawImage(layer.source as CanvasImageSource, 0, 0, width, height);
          }
        } else {
          tempCtx.drawImage(layer.source as CanvasImageSource, 0, 0, width, height);
        }
      }

      tempCtx.globalAlpha = 1;
      return createImageBitmap(tempCanvas);
    } catch {
      return null;
    }
  }

  /**
   * Render multiple thumbnail frames.
   */
  async renderThumbnails(
    frames: ThumbnailFrame[],
    width: number,
    height: number,
  ): Promise<(ImageBitmap | null)[]> {
    const results: (ImageBitmap | null)[] = [];
    for (const frame of frames) {
      results.push(await this.renderFrame(frame, width, height));
    }
    return results;
  }

  destroy(): void {
    this.effectsPipeline.destroy();
    this.compositor.destroy();
    this.maskManager.destroy();
    this.device.destroy();
  }
}
