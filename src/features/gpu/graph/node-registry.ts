/**
 * Node Registry
 *
 * Registry for shader node types. Allows registration and creation
 * of node instances by name.
 */

import type { ShaderNode, NodeFactory, NodeRegistry as INodeRegistry } from './types';

export class NodeRegistry implements INodeRegistry {
  private factories: Map<string, NodeFactory> = new Map();

  /**
   * Register a new node type
   */
  register(name: string, factory: NodeFactory): void {
    if (this.factories.has(name)) {
      console.warn(`Node type "${name}" is being overwritten`);
    }
    this.factories.set(name, factory);
  }

  /**
   * Create a node instance
   */
  create(name: string, id: string, params?: Record<string, unknown>): ShaderNode {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Node type "${name}" is not registered`);
    }
    return factory(id, params);
  }

  /**
   * Check if a node type is registered
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Get all registered node type names
   */
  getNames(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Unregister a node type
   */
  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  /**
   * Clear all registered node types
   */
  clear(): void {
    this.factories.clear();
  }
}

/**
 * Global node registry instance
 */
export const globalRegistry = new NodeRegistry();
