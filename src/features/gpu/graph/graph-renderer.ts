/**
 * Graph Renderer
 *
 * Connects shader graph execution to the RenderBackend system.
 * Handles texture creation, pass execution, and output.
 */

import type { RenderBackend, RenderTexture, TextureFormat } from '../backend/types';
import type { CompiledPass } from './types';
import type { PooledTexture } from './resource-pool';
import { ResourcePool } from './resource-pool';
import { RenderGraph, FrameDimensions, PassExecutionContext } from './render-graph';
import { PassMerger } from './pass-merger';

/**
 * Options for graph rendering
 */
export interface GraphRendererOptions {
  /** Enable pass merging optimization */
  enablePassMerging?: boolean;
  /** Default texture format */
  textureFormat?: TextureFormat;
}

/**
 * Source texture registration
 */
export interface SourceTextureInfo {
  /** Unique identifier */
  id: string;
  /** Backend texture handle */
  texture: RenderTexture;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Render result information
 */
export interface RenderResult {
  /** Total passes executed */
  passCount: number;
  /** Time spent rendering (ms) */
  renderTime: number;
  /** Textures allocated this frame */
  texturesAllocated: number;
  /** Textures reused from pool */
  texturesReused: number;
}

/**
 * Graph Renderer
 *
 * Integrates shader graph execution with the GPU backend.
 */
export class GraphRenderer {
  private backend: RenderBackend | null = null;
  private pool: ResourcePool;
  private renderGraph: RenderGraph;
  private passMerger: PassMerger;
  private options: GraphRendererOptions;

  /** Source textures registered for rendering */
  private sourceTextures: Map<string, SourceTextureInfo> = new Map();

  /** Backend textures mapped to pooled textures */
  private textureMapping: Map<string, RenderTexture> = new Map();

  constructor(options: GraphRendererOptions = {}) {
    this.options = {
      enablePassMerging: true,
      textureFormat: 'rgba8unorm',
      ...options,
    };

    this.pool = new ResourcePool();
    this.renderGraph = new RenderGraph(this.pool);
    this.passMerger = new PassMerger();

    // Set up pass execution callback
    this.renderGraph.onPassExecute = this.executePass.bind(this);
  }

  /**
   * Set the render backend
   */
  setBackend(backend: RenderBackend): void {
    this.backend = backend;
  }

  /**
   * Get the current render backend
   */
  getBackend(): RenderBackend | null {
    return this.backend;
  }

  /**
   * Register a source texture
   */
  registerSourceTexture(info: SourceTextureInfo): void {
    this.sourceTextures.set(info.id, info);
    this.renderGraph.setSourceTexture(info.id, info);
  }

  /**
   * Unregister a source texture
   */
  unregisterSourceTexture(id: string): boolean {
    return this.sourceTextures.delete(id);
  }

  /**
   * Clear all source textures
   */
  clearSourceTextures(): void {
    this.sourceTextures.clear();
    this.renderGraph.clearSourceTextures();
  }

  /**
   * Render compiled passes to screen
   */
  render(passes: CompiledPass[], dimensions: FrameDimensions): RenderResult {
    const startTime = performance.now();

    if (!this.backend) {
      throw new Error('No render backend set');
    }

    // Optionally merge passes
    let finalPasses = passes;
    if (this.options.enablePassMerging) {
      const mergeResult = this.passMerger.merge(passes);
      finalPasses = mergeResult.passes;
    }

    // Clear texture mapping for new frame
    this.textureMapping.clear();

    // Record stats before rendering
    const allocsBefore = this.pool.getTotalAllocations();
    const reuseBefore = this.pool.getReuseCount();

    // Execute render graph
    this.renderGraph.execute(finalPasses, dimensions);

    // Calculate stats
    const allocsAfter = this.pool.getTotalAllocations();
    const reuseAfter = this.pool.getReuseCount();

    return {
      passCount: finalPasses.length,
      renderTime: performance.now() - startTime,
      texturesAllocated: allocsAfter - allocsBefore,
      texturesReused: reuseAfter - reuseBefore,
    };
  }

  /**
   * Render to a texture for export/readback
   */
  renderToTexture(
    passes: CompiledPass[],
    dimensions: FrameDimensions
  ): RenderTexture | null {
    if (!this.backend) {
      throw new Error('No render backend set');
    }

    // Create output texture
    const outputTexture = this.backend.createTexture({
      width: dimensions.width,
      height: dimensions.height,
      format: this.options.textureFormat!,
      usage: 'render-target',
    });

    // Modify last pass to render to texture instead of screen
    const passesToRender = [...passes];
    if (passesToRender.length > 0) {
      const lastPass = { ...passesToRender[passesToRender.length - 1] };
      lastPass.output = outputTexture.id;
      passesToRender[passesToRender.length - 1] = lastPass;
    }

    // Execute passes
    this.render(passesToRender, dimensions);

    return outputTexture;
  }

  /**
   * Read pixels from a texture
   */
  async readPixels(texture: RenderTexture): Promise<Uint8Array | null> {
    if (!this.backend) {
      return null;
    }

    // Use backend's readback capability if available
    const capabilities = this.backend.getCapabilities();
    if (!capabilities.features.has('readback')) {
      return null;
    }

    return this.backend.readPixels(texture);
  }

  /**
   * Execute a single render pass
   */
  private executePass(pass: CompiledPass, context: PassExecutionContext): void {
    if (!this.backend) return;

    // Get or create output texture
    let outputTexture: RenderTexture | undefined;
    if (pass.output !== 'screen' && context.outputTexture) {
      outputTexture = this.getOrCreateBackendTexture(
        context.outputTexture,
        context.dimensions
      );
    }

    // Collect input textures
    const inputTextures: RenderTexture[] = [];
    for (const [inputName] of context.inputTextures) {
      // Check if it's a source texture
      const sourceInfo = this.sourceTextures.get(inputName);
      if (sourceInfo) {
        inputTextures.push(sourceInfo.texture);
        continue;
      }

      // Check if it's an intermediate texture
      const backendTex = this.textureMapping.get(inputName);
      if (backendTex) {
        inputTextures.push(backendTex);
      }
    }

    // Execute the pass using backend
    this.backend.beginPass(outputTexture);

    // Set uniforms
    for (const [name, value] of Object.entries(context.uniforms)) {
      this.backend.setUniform(name, value);
    }

    // Bind input textures
    inputTextures.forEach((tex, index) => {
      this.backend.bindTexture(tex, index);
    });

    // Draw fullscreen quad
    this.backend.drawFullscreenQuad();

    this.backend.endPass();

    // Store output texture mapping
    if (outputTexture && context.outputTexture) {
      this.textureMapping.set(pass.output, outputTexture);
    }
  }

  /**
   * Get or create a backend texture for a pooled texture
   */
  private getOrCreateBackendTexture(
    pooledTexture: PooledTexture,
    dimensions: FrameDimensions
  ): RenderTexture {
    // Check if we already have a backend texture for this
    const existing = this.textureMapping.get(pooledTexture.id);
    if (existing) {
      return existing;
    }

    // Create new backend texture
    const texture = this.backend!.createTexture({
      width: dimensions.width,
      height: dimensions.height,
      format: this.options.textureFormat!,
      usage: 'render-target',
    });

    return texture;
  }

  /**
   * Get rendering statistics
   */
  getStats(): {
    poolSize: number;
    inUseTextures: number;
    totalAllocations: number;
    reuseCount: number;
  } {
    return {
      poolSize: this.pool.getPoolSize(),
      inUseTextures: this.pool.getInUseCount(),
      totalAllocations: this.pool.getTotalAllocations(),
      reuseCount: this.pool.getReuseCount(),
    };
  }

  /**
   * Clear texture pool
   */
  clearPool(): void {
    this.pool.clear();
    this.textureMapping.clear();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clearPool();
    this.clearSourceTextures();
    this.backend = null;
  }
}

/**
 * Create a new graph renderer
 */
export function createGraphRenderer(options?: GraphRendererOptions): GraphRenderer {
  return new GraphRenderer(options);
}
