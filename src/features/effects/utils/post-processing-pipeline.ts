/**
 * WebGL Post-Processing Pipeline for Adjustment Layers
 *
 * Provides an extensible system for applying GPU-accelerated effects
 * to captured composition frames. Designed to support multiple effect
 * types (halftone, pixelate, etc.) via modular shader system.
 */

import { HalftoneRenderer, type HalftoneGLOptions } from './halftone-shader';

// Effect types that can be processed by the pipeline
export type PostProcessingEffectType = 'halftone' | 'pixelate' | 'posterize';

export interface PostProcessingEffect {
  type: PostProcessingEffectType;
  options: HalftoneGLOptions; // Extend with union type as more effects are added
}

/**
 * PostProcessingPipeline manages WebGL-based effect rendering for adjustment layers.
 *
 * Architecture:
 * - Maintains a single canvas/WebGL context per pipeline instance
 * - Supports multiple effect types via modular renderers
 * - Designed for efficient frame-by-frame processing
 *
 * Future extensions:
 * - Add more effect renderers (pixelate, posterize, etc.)
 * - Chain multiple effects in sequence
 * - Support effect intensity/opacity blending
 */
export class PostProcessingPipeline {
  private canvas: HTMLCanvasElement;
  private halftoneRenderer: HalftoneRenderer | null = null;
  private currentEffect: PostProcessingEffectType | null = null;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Initialize or switch to a specific effect renderer
   */
  private ensureRenderer(effectType: PostProcessingEffectType): boolean {
    if (this.currentEffect === effectType) {
      return this.halftoneRenderer?.isReady() ?? false;
    }

    // Dispose previous renderer
    this.disposeRenderers();

    // Create new renderer based on effect type
    switch (effectType) {
      case 'halftone':
        this.halftoneRenderer = new HalftoneRenderer(this.canvas);
        this.currentEffect = 'halftone';
        return this.halftoneRenderer.isReady();

      // Future effect renderers
      case 'pixelate':
      case 'posterize':
        console.warn(`[PostProcessingPipeline] Effect "${effectType}" not yet implemented`);
        return false;

      default:
        return false;
    }
  }

  /**
   * Resize the internal canvas
   */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;

      // Recreate renderer with new size if active
      if (this.currentEffect) {
        const effectType = this.currentEffect;
        this.disposeRenderers();
        this.ensureRenderer(effectType);
      }
    }
  }

  /**
   * Process a source image/canvas through the effect pipeline
   *
   * @param source - Source to process (canvas, image, or video)
   * @param effect - Effect configuration
   * @returns Processed canvas, or null if processing failed
   */
  process(
    source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
    effect: PostProcessingEffect
  ): HTMLCanvasElement | null {
    if (!this.ensureRenderer(effect.type)) {
      return null;
    }

    switch (effect.type) {
      case 'halftone':
        if (this.halftoneRenderer) {
          this.halftoneRenderer.render(source, effect.options as HalftoneGLOptions);
          return this.canvas;
        }
        break;

      // Future effect processing
      default:
        break;
    }

    return null;
  }

  /**
   * Get the output canvas for direct manipulation or display
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Check if pipeline is ready for processing
   */
  isReady(): boolean {
    return this.currentEffect !== null && (this.halftoneRenderer?.isReady() ?? false);
  }

  /**
   * Dispose of all renderers
   */
  private disposeRenderers(): void {
    if (this.halftoneRenderer) {
      this.halftoneRenderer.dispose();
      this.halftoneRenderer = null;
    }
    this.currentEffect = null;
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.disposeRenderers();
  }
}

/**
 * Singleton manager for adjustment layer post-processing
 *
 * Maintains a single pipeline instance to avoid recreating WebGL contexts
 * when adjustment layers change. Similar pattern to effectsWorkerManager.
 */
class AdjustmentPostProcessingManager {
  private pipeline: PostProcessingPipeline | null = null;
  private width = 0;
  private height = 0;

  /**
   * Get or create the post-processing pipeline
   */
  getPipeline(width: number, height: number): PostProcessingPipeline {
    if (!this.pipeline || this.width !== width || this.height !== height) {
      if (this.pipeline) {
        this.pipeline.dispose();
      }
      this.pipeline = new PostProcessingPipeline(width, height);
      this.width = width;
      this.height = height;
    }
    return this.pipeline;
  }

  /**
   * Dispose the pipeline (call on app unmount)
   */
  dispose(): void {
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
  }
}

export const adjustmentPostProcessingManager = new AdjustmentPostProcessingManager();
