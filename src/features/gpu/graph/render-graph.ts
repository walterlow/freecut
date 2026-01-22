/**
 * Render Graph
 *
 * Executes compiled shader graph passes with resource management.
 */

import type { CompiledPass } from './types';
import type { ResourcePool, PooledTexture } from './resource-pool';

/**
 * Frame dimensions
 */
export interface FrameDimensions {
  width: number;
  height: number;
}

/**
 * Context passed to pass execution callback
 */
export interface PassExecutionContext {
  /** Input textures by name */
  inputTextures: Map<string, PooledTexture | unknown>;
  /** Output texture (null for screen) */
  outputTexture: PooledTexture | null;
  /** Frame dimensions */
  dimensions: FrameDimensions;
  /** Pass uniforms */
  uniforms: Record<string, unknown>;
}

/**
 * Callback for pass execution
 */
export type PassExecuteCallback = (
  pass: CompiledPass,
  context: PassExecutionContext
) => void;

/**
 * Render Graph Executor
 *
 * Manages texture allocation and executes compiled passes in order.
 */
export class RenderGraph {
  private pool: ResourcePool;

  /** Maps output names to textures during frame execution */
  private outputTextures: Map<string, PooledTexture> = new Map();

  /** External source textures (video frames, images, etc.) */
  private sourceTextures: Map<string, unknown> = new Map();

  /** Callback for actual GPU execution */
  onPassExecute: PassExecuteCallback | null = null;

  constructor(pool: ResourcePool) {
    this.pool = pool;
  }

  /**
   * Set an external source texture
   */
  setSourceTexture(name: string, texture: unknown): void {
    this.sourceTextures.set(name, texture);
  }

  /**
   * Clear source textures
   */
  clearSourceTextures(): void {
    this.sourceTextures.clear();
  }

  /**
   * Execute a list of compiled passes
   */
  execute(passes: CompiledPass[], dimensions: FrameDimensions): void {
    this.pool.beginFrame();
    this.outputTextures.clear();

    try {
      for (const pass of passes) {
        this.executePass(pass, dimensions);
      }
    } finally {
      this.pool.endFrame();
      this.outputTextures.clear();
    }
  }

  /**
   * Execute a single pass
   */
  private executePass(pass: CompiledPass, dimensions: FrameDimensions): void {
    // Gather input textures
    const inputTextures = new Map<string, PooledTexture | unknown>();
    for (const inputName of pass.inputs) {
      // Check if it's an intermediate output
      const outputTex = this.outputTextures.get(inputName);
      if (outputTex) {
        inputTextures.set(inputName, outputTex);
        continue;
      }

      // Check if it's an external source
      const sourceTex = this.sourceTextures.get(inputName);
      if (sourceTex) {
        inputTextures.set(inputName, sourceTex);
        continue;
      }

      // Input not found - might be a source node ID
      // In a real implementation, would look up from source texture map
    }

    // Allocate output texture (unless rendering to screen)
    let outputTexture: PooledTexture | null = null;
    if (pass.output !== 'screen') {
      outputTexture = this.pool.acquire({
        width: dimensions.width,
        height: dimensions.height,
        format: 'rgba8unorm',
      });
      this.outputTextures.set(pass.output, outputTexture);
    }

    // Execute the pass via callback
    if (this.onPassExecute) {
      this.onPassExecute(pass, {
        inputTextures,
        outputTexture,
        dimensions,
        uniforms: pass.uniforms,
      });
    }
  }

  /**
   * Get texture for a named output (during frame execution)
   */
  getTextureForOutput(name: string): PooledTexture | undefined {
    return this.outputTextures.get(name);
  }

  /**
   * Get the resource pool
   */
  getPool(): ResourcePool {
    return this.pool;
  }
}
