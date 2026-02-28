/**
 * Transition Registry
 *
 * Map-based registry for transition definitions and renderers.
 * Follows the same pattern as src/features/gpu/graph/node-registry.ts.
 *
 * Each registered transition has:
 * - A TransitionDefinition (metadata for UI)
 * - A TransitionRenderer (calculation logic for CSS styles and canvas export)
 */

import type {
  TransitionDefinition,
  TransitionCategory,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition';
import type { TransitionStyleCalculation } from './engine';

/**
 * Renderer interface for CSS/DOM-based transitions (preview + Composition).
 * Each registered transition must provide this.
 */
export interface TransitionRenderer {
  /**
   * Calculate CSS styles for a clip at a given transition progress.
   * Used by the engine, preview, and Composition renderer.
   */
  calculateStyles(
    progress: number,
    isOutgoing: boolean,
    canvasWidth: number,
    canvasHeight: number,
    direction?: WipeDirection | SlideDirection | FlipDirection,
    properties?: Record<string, unknown>
  ): TransitionStyleCalculation;

  /**
   * Render the transition onto a Canvas 2D context (for export).
   * @param ctx - Output canvas context
   * @param leftCanvas - Pre-rendered outgoing clip
   * @param rightCanvas - Pre-rendered incoming clip
   * @param progress - Transition progress (0-1)
   * @param direction - Optional direction
   * @param canvas - Canvas dimensions { width, height }
   * @param properties - Optional custom properties
   */
  renderCanvas?(
    ctx: OffscreenCanvasRenderingContext2D,
    leftCanvas: OffscreenCanvas,
    rightCanvas: OffscreenCanvas,
    progress: number,
    direction?: WipeDirection | SlideDirection | FlipDirection,
    canvas?: { width: number; height: number },
    properties?: Record<string, unknown>
  ): void;

  /** Optional GLSL fragment shader source for WebGL acceleration */
  glslShader?: string;
}

/**
 * Entry stored in the registry for each transition.
 */
interface TransitionRegistryEntry {
  definition: TransitionDefinition;
  renderer: TransitionRenderer;
}

/**
 * Transition Registry class.
 * Stores transition definitions and renderers by presentation ID.
 */
export class TransitionRegistry {
  private entries: Map<string, TransitionRegistryEntry> = new Map();

  /**
   * Register a transition with its definition and renderer.
   */
  register(id: string, definition: TransitionDefinition, renderer: TransitionRenderer): void {
    if (this.entries.has(id)) {
      console.warn(`Transition "${id}" is being overwritten`);
    }
    this.entries.set(id, { definition, renderer });
  }

  /**
   * Unregister a transition by ID.
   */
  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Get a registry entry by ID.
   */
  get(id: string): TransitionRegistryEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get just the renderer for a transition ID.
   */
  getRenderer(id: string): TransitionRenderer | undefined {
    return this.entries.get(id)?.renderer;
  }

  /**
   * Get just the definition for a transition ID.
   */
  getDefinition(id: string): TransitionDefinition | undefined {
    return this.entries.get(id)?.definition;
  }

  /**
   * Check if a transition ID is registered.
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Get all registered entries.
   */
  getAll(): Map<string, TransitionRegistryEntry> {
    return new Map(this.entries);
  }

  /**
   * Get all entries in a given category.
   */
  getByCategory(category: TransitionCategory): TransitionRegistryEntry[] {
    const result: TransitionRegistryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.definition.category === category) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Get all definitions (for UI listing).
   */
  getDefinitions(): TransitionDefinition[] {
    return Array.from(this.entries.values()).map((e) => e.definition);
  }

  /**
   * Get all registered IDs.
   */
  getIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Clear all registered transitions.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get count of registered transitions.
   */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Global singleton transition registry.
 */
export const transitionRegistry = new TransitionRegistry();
