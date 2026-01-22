# WebGPU Phase 2: Shader Graph Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the shader graph node system and graph compiler, implementing essential effects (Brightness/Contrast, Saturation, Blur, Opacity) that can be chained together.

**Architecture:** Create a directed acyclic graph (DAG) of shader nodes that compiles down to GPU render passes. Users see a simple effect stack, but underneath it's a graph that can be optimized.

**Tech Stack:** TypeScript, WGSL shaders, Vitest

---

## Prerequisites

Before starting, ensure:
- Phase 1 is complete (RenderBackend abstraction)
- All Phase 1 tests pass (`npm run test:run`)
- Chrome 113+ for WebGPU testing

---

## Task 1: Define Core Graph Types

**Files:**
- Create: `src/features/gpu/graph/types.ts`
- Create: `src/features/gpu/graph/types.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type {
  ShaderNode,
  NodeInput,
  NodeOutput,
  Connection,
  ShaderGraph,
  NodeType,
  DataType,
} from './types';

describe('Graph Types', () => {
  it('should define node types correctly', () => {
    const nodeTypes: NodeType[] = ['source', 'effect', 'blend', 'transform', 'output'];
    expect(nodeTypes).toHaveLength(5);
  });

  it('should define data types correctly', () => {
    const dataTypes: DataType[] = ['color', 'alpha', 'number', 'vec2', 'vec4', 'texture'];
    expect(dataTypes).toHaveLength(6);
  });

  it('should allow creating a valid ShaderNode', () => {
    const node: ShaderNode = {
      id: 'brightness-1',
      type: 'effect',
      name: 'Brightness',
      inputs: {
        input: { name: 'input', type: 'texture', required: true },
      },
      outputs: {
        output: { name: 'output', type: 'texture' },
      },
      params: {
        brightness: { type: 'number', value: 0, min: -1, max: 1, default: 0 },
      },
    };

    expect(node.id).toBe('brightness-1');
    expect(node.type).toBe('effect');
    expect(node.inputs.input.type).toBe('texture');
  });

  it('should allow creating connections between nodes', () => {
    const connection: Connection = {
      id: 'conn-1',
      from: { nodeId: 'source-1', output: 'output' },
      to: { nodeId: 'effect-1', input: 'input' },
    };

    expect(connection.from.nodeId).toBe('source-1');
    expect(connection.to.nodeId).toBe('effect-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/graph/types.test.ts`
Expected: FAIL - Cannot find module './types'

**Step 3: Create the types file**

Create `src/features/gpu/graph/types.ts`:
```typescript
/**
 * Shader Graph Type Definitions
 *
 * Core types for the shader node graph system.
 */

/**
 * Node type categories
 */
export type NodeType = 'source' | 'effect' | 'blend' | 'transform' | 'output';

/**
 * Data types that flow between nodes
 */
export type DataType = 'color' | 'alpha' | 'number' | 'vec2' | 'vec4' | 'texture';

/**
 * Parameter types for node controls
 */
export type ParamType = 'number' | 'boolean' | 'color' | 'select';

/**
 * Input socket definition
 */
export interface NodeInput {
  name: string;
  type: DataType;
  required: boolean;
  default?: unknown;
}

/**
 * Output socket definition
 */
export interface NodeOutput {
  name: string;
  type: DataType;
}

/**
 * Parameter definition for user-adjustable values
 */
export interface ParamDef {
  type: ParamType;
  value: unknown;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
}

/**
 * Connection endpoint
 */
export interface ConnectionEndpoint {
  nodeId: string;
  output?: string;  // For 'from' endpoint
  input?: string;   // For 'to' endpoint
}

/**
 * Connection between two nodes
 */
export interface Connection {
  id: string;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
}

/**
 * WGSL shader fragment for a node
 */
export interface WGSLFragment {
  /** Uniform declarations */
  uniforms?: string;
  /** Main shader function */
  code: string;
  /** Entry point function name */
  entryPoint: string;
}

/**
 * A single node in the shader graph
 */
export interface ShaderNode {
  id: string;
  type: NodeType;
  name: string;
  inputs: Record<string, NodeInput>;
  outputs: Record<string, NodeOutput>;
  params: Record<string, ParamDef>;
  /** WGSL shader fragment (optional for source/output nodes) */
  shader?: WGSLFragment;
}

/**
 * Compiled render pass from the graph
 */
export interface CompiledPass {
  id: string;
  nodes: string[];  // Node IDs included in this pass
  shader: string;   // Combined WGSL code
  inputs: string[]; // Input texture IDs
  output: string;   // Output texture ID or 'screen'
  uniforms: Record<string, unknown>;
}

/**
 * The complete shader graph
 */
export interface ShaderGraph {
  id: string;
  nodes: Map<string, ShaderNode>;
  connections: Connection[];
}

/**
 * Node factory function type
 */
export type NodeFactory = (id: string, params?: Record<string, unknown>) => ShaderNode;

/**
 * Registry of available node types
 */
export interface NodeRegistry {
  register(name: string, factory: NodeFactory): void;
  create(name: string, id: string, params?: Record<string, unknown>): ShaderNode;
  getNames(): string[];
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/graph/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/graph/types.ts src/features/gpu/graph/types.test.ts
git commit -m "feat(gpu): add shader graph type definitions"
```

---

## Task 2: Implement Node Registry

**Files:**
- Create: `src/features/gpu/graph/node-registry.ts`
- Create: `src/features/gpu/graph/node-registry.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/node-registry.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from './node-registry';
import type { ShaderNode } from './types';

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('should start empty', () => {
    expect(registry.getNames()).toHaveLength(0);
  });

  it('should register a node factory', () => {
    registry.register('test-node', (id) => ({
      id,
      type: 'effect',
      name: 'Test Node',
      inputs: {},
      outputs: {},
      params: {},
    }));

    expect(registry.getNames()).toContain('test-node');
  });

  it('should create nodes from registered factories', () => {
    registry.register('brightness', (id, params) => ({
      id,
      type: 'effect',
      name: 'Brightness',
      inputs: {
        input: { name: 'input', type: 'texture', required: true },
      },
      outputs: {
        output: { name: 'output', type: 'texture' },
      },
      params: {
        value: { type: 'number', value: params?.value ?? 0, default: 0, min: -1, max: 1 },
      },
    }));

    const node = registry.create('brightness', 'brightness-1', { value: 0.5 });

    expect(node.id).toBe('brightness-1');
    expect(node.name).toBe('Brightness');
    expect(node.params.value.value).toBe(0.5);
  });

  it('should throw when creating unregistered node', () => {
    expect(() => registry.create('unknown', 'id-1')).toThrow(/not registered/);
  });

  it('should check if a node type exists', () => {
    registry.register('blur', (id) => ({
      id,
      type: 'effect',
      name: 'Blur',
      inputs: {},
      outputs: {},
      params: {},
    }));

    expect(registry.has('blur')).toBe(true);
    expect(registry.has('sharpen')).toBe(false);
  });
});
```

**Step 2: Implement NodeRegistry**

Create `src/features/gpu/graph/node-registry.ts`:
```typescript
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
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/node-registry.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/node-registry.ts src/features/gpu/graph/node-registry.test.ts
git commit -m "feat(gpu): add node registry for shader nodes"
```

---

## Task 3: Implement ShaderGraph Class

**Files:**
- Create: `src/features/gpu/graph/shader-graph.ts`
- Create: `src/features/gpu/graph/shader-graph.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/shader-graph.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderGraphBuilder } from './shader-graph';
import type { ShaderNode, Connection } from './types';

describe('ShaderGraphBuilder', () => {
  let graph: ShaderGraphBuilder;

  const createSourceNode = (id: string): ShaderNode => ({
    id,
    type: 'source',
    name: 'Source',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {},
  });

  const createEffectNode = (id: string, name: string): ShaderNode => ({
    id,
    type: 'effect',
    name,
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      value: { type: 'number', value: 0, default: 0, min: -1, max: 1 },
    },
  });

  const createOutputNode = (id: string): ShaderNode => ({
    id,
    type: 'output',
    name: 'Output',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {},
  });

  beforeEach(() => {
    graph = new ShaderGraphBuilder();
  });

  describe('node management', () => {
    it('should add nodes', () => {
      const source = createSourceNode('source-1');
      graph.addNode(source);

      expect(graph.getNode('source-1')).toBe(source);
      expect(graph.getNodes()).toHaveLength(1);
    });

    it('should remove nodes', () => {
      const source = createSourceNode('source-1');
      graph.addNode(source);
      graph.removeNode('source-1');

      expect(graph.getNode('source-1')).toBeUndefined();
    });

    it('should update node params', () => {
      const effect = createEffectNode('effect-1', 'Brightness');
      graph.addNode(effect);

      graph.updateNodeParams('effect-1', { value: 0.5 });

      expect(graph.getNode('effect-1')?.params.value.value).toBe(0.5);
    });
  });

  describe('connections', () => {
    it('should connect nodes', () => {
      const source = createSourceNode('source-1');
      const effect = createEffectNode('effect-1', 'Brightness');

      graph.addNode(source);
      graph.addNode(effect);
      graph.connect('source-1', 'output', 'effect-1', 'input');

      const connections = graph.getConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0].from.nodeId).toBe('source-1');
      expect(connections[0].to.nodeId).toBe('effect-1');
    });

    it('should disconnect nodes', () => {
      const source = createSourceNode('source-1');
      const effect = createEffectNode('effect-1', 'Brightness');

      graph.addNode(source);
      graph.addNode(effect);
      const connId = graph.connect('source-1', 'output', 'effect-1', 'input');
      graph.disconnect(connId);

      expect(graph.getConnections()).toHaveLength(0);
    });

    it('should remove connections when node is removed', () => {
      const source = createSourceNode('source-1');
      const effect = createEffectNode('effect-1', 'Brightness');

      graph.addNode(source);
      graph.addNode(effect);
      graph.connect('source-1', 'output', 'effect-1', 'input');
      graph.removeNode('source-1');

      expect(graph.getConnections()).toHaveLength(0);
    });
  });

  describe('topology', () => {
    it('should get topologically sorted nodes', () => {
      const source = createSourceNode('source-1');
      const effect1 = createEffectNode('effect-1', 'Brightness');
      const effect2 = createEffectNode('effect-2', 'Contrast');
      const output = createOutputNode('output-1');

      graph.addNode(source);
      graph.addNode(effect1);
      graph.addNode(effect2);
      graph.addNode(output);

      graph.connect('source-1', 'output', 'effect-1', 'input');
      graph.connect('effect-1', 'output', 'effect-2', 'input');
      graph.connect('effect-2', 'output', 'output-1', 'input');

      const sorted = graph.getTopologicallySorted();

      // Source should come first, output should come last
      expect(sorted[0].id).toBe('source-1');
      expect(sorted[sorted.length - 1].id).toBe('output-1');
    });

    it('should detect cycles', () => {
      const effect1 = createEffectNode('effect-1', 'Brightness');
      const effect2 = createEffectNode('effect-2', 'Contrast');

      // Make effect2 also output to effect1's input
      effect1.inputs.input2 = { name: 'input2', type: 'texture', required: false };

      graph.addNode(effect1);
      graph.addNode(effect2);

      graph.connect('effect-1', 'output', 'effect-2', 'input');

      // This would create a cycle
      expect(() => {
        graph.connect('effect-2', 'output', 'effect-1', 'input2');
      }).toThrow(/cycle/i);
    });
  });

  describe('serialization', () => {
    it('should export to JSON', () => {
      const source = createSourceNode('source-1');
      const effect = createEffectNode('effect-1', 'Brightness');

      graph.addNode(source);
      graph.addNode(effect);
      graph.connect('source-1', 'output', 'effect-1', 'input');

      const json = graph.toJSON();

      expect(json.nodes).toHaveLength(2);
      expect(json.connections).toHaveLength(1);
    });
  });
});
```

**Step 2: Implement ShaderGraphBuilder**

Create `src/features/gpu/graph/shader-graph.ts`:
```typescript
/**
 * Shader Graph Builder
 *
 * Manages the construction and manipulation of shader node graphs.
 */

import type { ShaderNode, Connection, ShaderGraph } from './types';

let connectionIdCounter = 0;

export class ShaderGraphBuilder {
  private nodes: Map<string, ShaderNode> = new Map();
  private connections: Connection[] = [];
  private graphId: string;

  constructor(id?: string) {
    this.graphId = id ?? `graph-${Date.now()}`;
  }

  // === Node Management ===

  addNode(node: ShaderNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`);
    }
    this.nodes.set(node.id, { ...node });
  }

  removeNode(nodeId: string): boolean {
    if (!this.nodes.has(nodeId)) {
      return false;
    }

    // Remove all connections involving this node
    this.connections = this.connections.filter(
      conn => conn.from.nodeId !== nodeId && conn.to.nodeId !== nodeId
    );

    return this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): ShaderNode | undefined {
    return this.nodes.get(nodeId);
  }

  getNodes(): ShaderNode[] {
    return Array.from(this.nodes.values());
  }

  updateNodeParams(nodeId: string, params: Record<string, unknown>): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node "${nodeId}" not found`);
    }

    for (const [key, value] of Object.entries(params)) {
      if (node.params[key]) {
        node.params[key].value = value;
      }
    }
  }

  // === Connection Management ===

  connect(
    fromNodeId: string,
    fromOutput: string,
    toNodeId: string,
    toInput: string
  ): string {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);

    if (!fromNode) throw new Error(`Source node "${fromNodeId}" not found`);
    if (!toNode) throw new Error(`Target node "${toNodeId}" not found`);

    if (!fromNode.outputs[fromOutput]) {
      throw new Error(`Output "${fromOutput}" not found on node "${fromNodeId}"`);
    }
    if (!toNode.inputs[toInput]) {
      throw new Error(`Input "${toInput}" not found on node "${toNodeId}"`);
    }

    // Check for existing connection to this input
    const existingConn = this.connections.find(
      c => c.to.nodeId === toNodeId && c.to.input === toInput
    );
    if (existingConn) {
      // Remove existing connection to this input
      this.connections = this.connections.filter(c => c.id !== existingConn.id);
    }

    const connection: Connection = {
      id: `conn-${++connectionIdCounter}`,
      from: { nodeId: fromNodeId, output: fromOutput },
      to: { nodeId: toNodeId, input: toInput },
    };

    // Check for cycles before adding
    if (this.wouldCreateCycle(connection)) {
      throw new Error('Connection would create a cycle in the graph');
    }

    this.connections.push(connection);
    return connection.id;
  }

  disconnect(connectionId: string): boolean {
    const index = this.connections.findIndex(c => c.id === connectionId);
    if (index === -1) return false;
    this.connections.splice(index, 1);
    return true;
  }

  getConnections(): Connection[] {
    return [...this.connections];
  }

  getInputConnections(nodeId: string): Connection[] {
    return this.connections.filter(c => c.to.nodeId === nodeId);
  }

  getOutputConnections(nodeId: string): Connection[] {
    return this.connections.filter(c => c.from.nodeId === nodeId);
  }

  // === Topology ===

  /**
   * Check if adding a connection would create a cycle
   */
  private wouldCreateCycle(newConnection: Connection): boolean {
    const visited = new Set<string>();
    const stack = [newConnection.from.nodeId];

    // Start from the source of the new connection and see if we can reach the target
    // by following existing connections backwards (from target's perspective)
    const canReach = (start: string, target: string): boolean => {
      if (start === target) return true;
      if (visited.has(start)) return false;

      visited.add(start);

      // Find all nodes that output TO this node
      const incoming = this.connections.filter(c => c.to.nodeId === start);
      for (const conn of incoming) {
        if (canReach(conn.from.nodeId, target)) return true;
      }

      // Also check the new connection
      if (newConnection.to.nodeId === start && newConnection.from.nodeId === target) {
        return true;
      }

      return false;
    };

    // Check if target of new connection can reach source (which would create cycle)
    return canReach(newConnection.to.nodeId, newConnection.from.nodeId);
  }

  /**
   * Get nodes in topological order (dependencies first)
   */
  getTopologicallySorted(): ShaderNode[] {
    const result: ShaderNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error('Cycle detected in graph');
      }

      visiting.add(nodeId);

      // Visit all nodes that this node depends on (inputs)
      const inputConns = this.getInputConnections(nodeId);
      for (const conn of inputConns) {
        visit(conn.from.nodeId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) result.push(node);
    };

    // Visit all nodes
    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return result;
  }

  /**
   * Find source nodes (no inputs connected)
   */
  getSourceNodes(): ShaderNode[] {
    return this.getNodes().filter(node => {
      const inputConns = this.getInputConnections(node.id);
      const requiredInputs = Object.values(node.inputs).filter(i => i.required);
      return requiredInputs.length === 0 || inputConns.length === 0;
    });
  }

  /**
   * Find output nodes (no outputs connected)
   */
  getOutputNodes(): ShaderNode[] {
    return this.getNodes().filter(node => {
      return this.getOutputConnections(node.id).length === 0 && node.type === 'output';
    });
  }

  // === Serialization ===

  toJSON(): { id: string; nodes: ShaderNode[]; connections: Connection[] } {
    return {
      id: this.graphId,
      nodes: this.getNodes(),
      connections: this.getConnections(),
    };
  }

  toGraph(): ShaderGraph {
    return {
      id: this.graphId,
      nodes: new Map(this.nodes),
      connections: [...this.connections],
    };
  }

  static fromJSON(data: { id: string; nodes: ShaderNode[]; connections: Connection[] }): ShaderGraphBuilder {
    const builder = new ShaderGraphBuilder(data.id);
    for (const node of data.nodes) {
      builder.addNode(node);
    }
    for (const conn of data.connections) {
      builder.connections.push(conn);
    }
    return builder;
  }
}
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/shader-graph.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/shader-graph.ts src/features/gpu/graph/shader-graph.test.ts
git commit -m "feat(gpu): add shader graph builder with topology"
```

---

## Task 4: Create Source Node

**Files:**
- Create: `src/features/gpu/graph/nodes/source-node.ts`
- Create: `src/features/gpu/graph/nodes/source-node.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/nodes/source-node.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createTextureSourceNode, createColorSourceNode } from './source-node';

describe('Source Nodes', () => {
  describe('TextureSourceNode', () => {
    it('should create a texture source node', () => {
      const node = createTextureSourceNode('source-1');

      expect(node.id).toBe('source-1');
      expect(node.type).toBe('source');
      expect(node.name).toBe('Texture Source');
      expect(node.outputs.output).toBeDefined();
      expect(node.outputs.output.type).toBe('texture');
    });

    it('should accept texture handle parameter', () => {
      const node = createTextureSourceNode('source-1', { textureId: 'tex-123' });

      expect(node.params.textureId.value).toBe('tex-123');
    });
  });

  describe('ColorSourceNode', () => {
    it('should create a solid color source node', () => {
      const node = createColorSourceNode('color-1');

      expect(node.id).toBe('color-1');
      expect(node.type).toBe('source');
      expect(node.name).toBe('Solid Color');
      expect(node.outputs.output.type).toBe('texture');
    });

    it('should accept color parameter', () => {
      const node = createColorSourceNode('color-1', { color: [1, 0, 0, 1] });

      expect(node.params.color.value).toEqual([1, 0, 0, 1]);
    });

    it('should have shader code', () => {
      const node = createColorSourceNode('color-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('fn');
    });
  });
});
```

**Step 2: Implement source nodes**

Create `src/features/gpu/graph/nodes/source-node.ts`:
```typescript
/**
 * Source Nodes
 *
 * Nodes that provide input to the shader graph (textures, colors, etc.)
 */

import type { ShaderNode } from '../types';

/**
 * Create a texture source node
 * This node outputs an existing texture (video frame, image, etc.)
 */
export function createTextureSourceNode(
  id: string,
  params?: { textureId?: string }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Texture Source',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      textureId: {
        type: 'number', // Stored as string but type system uses 'number' for IDs
        value: params?.textureId ?? '',
        default: '',
      },
    },
    // No shader - this node just passes through an existing texture
  };
}

/**
 * Create a solid color source node
 * This node generates a solid color texture
 */
export function createColorSourceNode(
  id: string,
  params?: { color?: [number, number, number, number]; width?: number; height?: number }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Solid Color',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      color: {
        type: 'color',
        value: params?.color ?? [0, 0, 0, 1],
        default: [0, 0, 0, 1],
      },
      width: {
        type: 'number',
        value: params?.width ?? 1920,
        default: 1920,
        min: 1,
        max: 8192,
      },
      height: {
        type: 'number',
        value: params?.height ?? 1080,
        default: 1080,
        min: 1,
        max: 8192,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  color: vec4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
`,
      code: `
@fragment
fn main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return uniforms.color;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Create a gradient source node
 */
export function createGradientSourceNode(
  id: string,
  params?: {
    startColor?: [number, number, number, number];
    endColor?: [number, number, number, number];
    angle?: number;
  }
): ShaderNode {
  return {
    id,
    type: 'source',
    name: 'Gradient',
    inputs: {},
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      startColor: {
        type: 'color',
        value: params?.startColor ?? [0, 0, 0, 1],
        default: [0, 0, 0, 1],
      },
      endColor: {
        type: 'color',
        value: params?.endColor ?? [1, 1, 1, 1],
        default: [1, 1, 1, 1],
      },
      angle: {
        type: 'number',
        value: params?.angle ?? 0,
        default: 0,
        min: 0,
        max: 360,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  startColor: vec4f,
  endColor: vec4f,
  angle: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
`,
      code: `
@fragment
fn main(@builtin(position) pos: vec4f, @location(0) uv: vec2f) -> @location(0) vec4f {
  let angle = uniforms.angle * 3.14159 / 180.0;
  let dir = vec2f(cos(angle), sin(angle));
  let t = dot(uv - 0.5, dir) + 0.5;
  return mix(uniforms.startColor, uniforms.endColor, clamp(t, 0.0, 1.0));
}
`,
      entryPoint: 'main',
    },
  };
}
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/nodes/source-node.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/nodes/source-node.ts src/features/gpu/graph/nodes/source-node.test.ts
git commit -m "feat(gpu): add source nodes for shader graph"
```

---

## Task 5: Create Effect Nodes (Brightness, Contrast, Saturation)

**Files:**
- Create: `src/features/gpu/graph/nodes/effect-nodes.ts`
- Create: `src/features/gpu/graph/nodes/effect-nodes.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/nodes/effect-nodes.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  createBrightnessNode,
  createContrastNode,
  createSaturationNode,
  createOpacityNode,
} from './effect-nodes';

describe('Effect Nodes', () => {
  describe('BrightnessNode', () => {
    it('should create a brightness effect node', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Brightness');
      expect(node.inputs.input).toBeDefined();
      expect(node.outputs.output).toBeDefined();
      expect(node.params.brightness).toBeDefined();
    });

    it('should have valid brightness range', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.params.brightness.min).toBe(-1);
      expect(node.params.brightness.max).toBe(1);
      expect(node.params.brightness.default).toBe(0);
    });

    it('should accept initial brightness value', () => {
      const node = createBrightnessNode('brightness-1', { brightness: 0.5 });

      expect(node.params.brightness.value).toBe(0.5);
    });

    it('should have WGSL shader code', () => {
      const node = createBrightnessNode('brightness-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('brightness');
    });
  });

  describe('ContrastNode', () => {
    it('should create a contrast effect node', () => {
      const node = createContrastNode('contrast-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Contrast');
      expect(node.params.contrast).toBeDefined();
    });

    it('should have valid contrast range', () => {
      const node = createContrastNode('contrast-1');

      expect(node.params.contrast.min).toBe(-1);
      expect(node.params.contrast.max).toBe(1);
    });
  });

  describe('SaturationNode', () => {
    it('should create a saturation effect node', () => {
      const node = createSaturationNode('saturation-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Saturation');
      expect(node.params.saturation).toBeDefined();
    });

    it('should have valid saturation range', () => {
      const node = createSaturationNode('saturation-1');

      expect(node.params.saturation.min).toBe(-1);
      expect(node.params.saturation.max).toBe(1);
    });
  });

  describe('OpacityNode', () => {
    it('should create an opacity effect node', () => {
      const node = createOpacityNode('opacity-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Opacity');
      expect(node.params.opacity).toBeDefined();
    });

    it('should have valid opacity range', () => {
      const node = createOpacityNode('opacity-1');

      expect(node.params.opacity.min).toBe(0);
      expect(node.params.opacity.max).toBe(1);
      expect(node.params.opacity.default).toBe(1);
    });
  });
});
```

**Step 2: Implement effect nodes**

Create `src/features/gpu/graph/nodes/effect-nodes.ts`:
```typescript
/**
 * Effect Nodes
 *
 * Color correction and adjustment effect nodes.
 */

import type { ShaderNode } from '../types';

/**
 * Brightness adjustment node
 */
export function createBrightnessNode(
  id: string,
  params?: { brightness?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Brightness',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      brightness: {
        type: 'number',
        value: params?.brightness ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  brightness: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  let adjusted = color.rgb + uniforms.brightness;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Contrast adjustment node
 */
export function createContrastNode(
  id: string,
  params?: { contrast?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Contrast',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      contrast: {
        type: 'number',
        value: params?.contrast ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  contrast: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Contrast: scale around 0.5 midpoint
  let factor = 1.0 + uniforms.contrast;
  let adjusted = (color.rgb - 0.5) * factor + 0.5;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Saturation adjustment node
 */
export function createSaturationNode(
  id: string,
  params?: { saturation?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Saturation',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      saturation: {
        type: 'number',
        value: params?.saturation ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  saturation: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Luminance using standard coefficients
  let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let gray = vec3f(luminance);
  // Saturation: interpolate between gray and color
  let factor = 1.0 + uniforms.saturation;
  let adjusted = mix(gray, color.rgb, factor);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Opacity adjustment node
 */
export function createOpacityNode(
  id: string,
  params?: { opacity?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Opacity',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      opacity: {
        type: 'number',
        value: params?.opacity ?? 1,
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  opacity: f32,
  _padding: vec3f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  return vec4f(color.rgb, color.a * uniforms.opacity);
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Combined brightness/contrast node (more efficient than separate)
 */
export function createBrightnessContrastNode(
  id: string,
  params?: { brightness?: number; contrast?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Brightness/Contrast',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      brightness: {
        type: 'number',
        value: params?.brightness ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
      contrast: {
        type: 'number',
        value: params?.contrast ?? 0,
        default: 0,
        min: -1,
        max: 1,
        step: 0.01,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  brightness: f32,
  contrast: f32,
  _padding: vec2f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inputTexture, inputSampler, uv);
  // Apply contrast first, then brightness
  let contrastFactor = 1.0 + uniforms.contrast;
  let adjusted = (color.rgb - 0.5) * contrastFactor + 0.5 + uniforms.brightness;
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
`,
      entryPoint: 'main',
    },
  };
}
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/nodes/effect-nodes.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/nodes/effect-nodes.ts src/features/gpu/graph/nodes/effect-nodes.test.ts
git commit -m "feat(gpu): add color correction effect nodes"
```

---

## Task 6: Create Blur Effect Node

**Files:**
- Create: `src/features/gpu/graph/nodes/blur-node.ts`
- Create: `src/features/gpu/graph/nodes/blur-node.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/nodes/blur-node.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createBlurNode, createGaussianBlurNode } from './blur-node';

describe('Blur Nodes', () => {
  describe('BlurNode', () => {
    it('should create a box blur node', () => {
      const node = createBlurNode('blur-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Blur');
      expect(node.params.radius).toBeDefined();
    });

    it('should have valid radius range', () => {
      const node = createBlurNode('blur-1');

      expect(node.params.radius.min).toBe(0);
      expect(node.params.radius.max).toBeGreaterThan(0);
    });

    it('should accept initial radius', () => {
      const node = createBlurNode('blur-1', { radius: 5 });

      expect(node.params.radius.value).toBe(5);
    });
  });

  describe('GaussianBlurNode', () => {
    it('should create a gaussian blur node', () => {
      const node = createGaussianBlurNode('gblur-1');

      expect(node.type).toBe('effect');
      expect(node.name).toBe('Gaussian Blur');
      expect(node.params.sigma).toBeDefined();
    });

    it('should have WGSL shader code', () => {
      const node = createGaussianBlurNode('gblur-1');

      expect(node.shader).toBeDefined();
      expect(node.shader?.code).toContain('gaussian');
    });
  });
});
```

**Step 2: Implement blur nodes**

Create `src/features/gpu/graph/nodes/blur-node.ts`:
```typescript
/**
 * Blur Effect Nodes
 *
 * Various blur implementations for the shader graph.
 */

import type { ShaderNode } from '../types';

/**
 * Simple box blur node
 */
export function createBlurNode(
  id: string,
  params?: { radius?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      radius: {
        type: 'number',
        value: params?.radius ?? 1,
        default: 1,
        min: 0,
        max: 50,
        step: 1,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  radius: f32,
  texelSize: vec2f,
  _padding: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let radius = i32(uniforms.radius);
  if (radius == 0) {
    return textureSample(inputTexture, inputSampler, uv);
  }

  var color = vec4f(0.0);
  var count = 0.0;

  for (var x = -radius; x <= radius; x++) {
    for (var y = -radius; y <= radius; y++) {
      let offset = vec2f(f32(x), f32(y)) * uniforms.texelSize;
      color += textureSample(inputTexture, inputSampler, uv + offset);
      count += 1.0;
    }
  }

  return color / count;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Gaussian blur node (separable, two-pass)
 * Note: This generates code for a single pass (horizontal or vertical)
 * The graph compiler should create two passes for full blur
 */
export function createGaussianBlurNode(
  id: string,
  params?: { sigma?: number; direction?: 'horizontal' | 'vertical' }
): ShaderNode {
  const direction = params?.direction ?? 'horizontal';

  return {
    id,
    type: 'effect',
    name: 'Gaussian Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      sigma: {
        type: 'number',
        value: params?.sigma ?? 2,
        default: 2,
        min: 0.1,
        max: 20,
        step: 0.1,
      },
      direction: {
        type: 'select',
        value: direction,
        default: 'horizontal',
        options: [
          { label: 'Horizontal', value: 'horizontal' },
          { label: 'Vertical', value: 'vertical' },
        ],
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  sigma: f32,
  texelSize: vec2f,
  direction: f32, // 0 = horizontal, 1 = vertical
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

fn gaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (sqrt(2.0 * 3.14159) * sigma);
}
`,
      code: `
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sigma = uniforms.sigma;
  let radius = i32(ceil(sigma * 3.0));

  var color = vec4f(0.0);
  var weightSum = 0.0;

  let dir = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), uniforms.direction > 0.5);

  for (var i = -radius; i <= radius; i++) {
    let weight = gaussian(f32(i), sigma);
    let offset = dir * f32(i) * uniforms.texelSize;
    color += textureSample(inputTexture, inputSampler, uv + offset) * weight;
    weightSum += weight;
  }

  return color / weightSum;
}
`,
      entryPoint: 'main',
    },
  };
}

/**
 * Fast approximate blur using downsampling
 */
export function createFastBlurNode(
  id: string,
  params?: { strength?: number }
): ShaderNode {
  return {
    id,
    type: 'effect',
    name: 'Fast Blur',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {
      output: { name: 'output', type: 'texture' },
    },
    params: {
      strength: {
        type: 'number',
        value: params?.strength ?? 1,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
      },
    },
    shader: {
      uniforms: `
struct Uniforms {
  strength: f32,
  texelSize: vec2f,
  _padding: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
`,
      code: `
// Kawase blur - fast approximation
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let offset = uniforms.texelSize * uniforms.strength;

  var color = textureSample(inputTexture, inputSampler, uv);
  color += textureSample(inputTexture, inputSampler, uv + vec2f(-offset.x, -offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f( offset.x, -offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f(-offset.x,  offset.y));
  color += textureSample(inputTexture, inputSampler, uv + vec2f( offset.x,  offset.y));

  return color / 5.0;
}
`,
      entryPoint: 'main',
    },
  };
}
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/nodes/blur-node.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/nodes/blur-node.ts src/features/gpu/graph/nodes/blur-node.test.ts
git commit -m "feat(gpu): add blur effect nodes"
```

---

## Task 7: Create Output Node

**Files:**
- Create: `src/features/gpu/graph/nodes/output-node.ts`
- Create: `src/features/gpu/graph/nodes/output-node.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/nodes/output-node.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createOutputNode, createExportOutputNode } from './output-node';

describe('Output Nodes', () => {
  describe('OutputNode', () => {
    it('should create a screen output node', () => {
      const node = createOutputNode('output-1');

      expect(node.type).toBe('output');
      expect(node.name).toBe('Output');
      expect(node.inputs.input).toBeDefined();
      expect(node.inputs.input.required).toBe(true);
      expect(Object.keys(node.outputs)).toHaveLength(0);
    });
  });

  describe('ExportOutputNode', () => {
    it('should create an export output node', () => {
      const node = createExportOutputNode('export-1');

      expect(node.type).toBe('output');
      expect(node.name).toBe('Export');
      expect(node.params.width).toBeDefined();
      expect(node.params.height).toBeDefined();
    });

    it('should accept resolution parameters', () => {
      const node = createExportOutputNode('export-1', {
        width: 3840,
        height: 2160,
      });

      expect(node.params.width.value).toBe(3840);
      expect(node.params.height.value).toBe(2160);
    });
  });
});
```

**Step 2: Implement output nodes**

Create `src/features/gpu/graph/nodes/output-node.ts`:
```typescript
/**
 * Output Nodes
 *
 * Terminal nodes that represent final outputs (screen, export, etc.)
 */

import type { ShaderNode } from '../types';

/**
 * Screen output node
 * Renders to the visible canvas
 */
export function createOutputNode(id: string): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Output',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {},
    // No shader - handled by the render graph
  };
}

/**
 * Export output node
 * Renders to a texture for readback/export
 */
export function createExportOutputNode(
  id: string,
  params?: { width?: number; height?: number; format?: string }
): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Export',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {
      width: {
        type: 'number',
        value: params?.width ?? 1920,
        default: 1920,
        min: 1,
        max: 8192,
      },
      height: {
        type: 'number',
        value: params?.height ?? 1080,
        default: 1080,
        min: 1,
        max: 8192,
      },
      format: {
        type: 'select',
        value: params?.format ?? 'rgba8unorm',
        default: 'rgba8unorm',
        options: [
          { label: 'RGBA 8-bit', value: 'rgba8unorm' },
          { label: 'RGBA 16-bit Float', value: 'rgba16float' },
        ],
      },
    },
  };
}

/**
 * Preview output node (lower resolution for performance)
 */
export function createPreviewOutputNode(
  id: string,
  params?: { scale?: number }
): ShaderNode {
  return {
    id,
    type: 'output',
    name: 'Preview',
    inputs: {
      input: { name: 'input', type: 'texture', required: true },
    },
    outputs: {},
    params: {
      scale: {
        type: 'number',
        value: params?.scale ?? 0.5,
        default: 0.5,
        min: 0.1,
        max: 1,
        step: 0.1,
      },
    },
  };
}
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/nodes/output-node.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/nodes/output-node.ts src/features/gpu/graph/nodes/output-node.test.ts
git commit -m "feat(gpu): add output nodes for shader graph"
```

---

## Task 8: Create Node Index and Register Built-in Nodes

**Files:**
- Create: `src/features/gpu/graph/nodes/index.ts`
- Create: `src/features/gpu/graph/nodes/index.test.ts`
- Create: `src/features/gpu/graph/index.ts`

**Step 1: Create nodes index**

Create `src/features/gpu/graph/nodes/index.ts`:
```typescript
/**
 * Shader Graph Nodes
 *
 * All built-in node types for the shader graph system.
 */

// Source nodes
export {
  createTextureSourceNode,
  createColorSourceNode,
  createGradientSourceNode,
} from './source-node';

// Effect nodes
export {
  createBrightnessNode,
  createContrastNode,
  createSaturationNode,
  createOpacityNode,
  createBrightnessContrastNode,
} from './effect-nodes';

// Blur nodes
export {
  createBlurNode,
  createGaussianBlurNode,
  createFastBlurNode,
} from './blur-node';

// Output nodes
export {
  createOutputNode,
  createExportOutputNode,
  createPreviewOutputNode,
} from './output-node';

// Re-export node registration helper
import { NodeRegistry, globalRegistry } from '../node-registry';
import { createTextureSourceNode, createColorSourceNode, createGradientSourceNode } from './source-node';
import { createBrightnessNode, createContrastNode, createSaturationNode, createOpacityNode, createBrightnessContrastNode } from './effect-nodes';
import { createBlurNode, createGaussianBlurNode, createFastBlurNode } from './blur-node';
import { createOutputNode, createExportOutputNode, createPreviewOutputNode } from './output-node';

/**
 * Register all built-in nodes with a registry
 */
export function registerBuiltinNodes(registry: NodeRegistry = globalRegistry): void {
  // Sources
  registry.register('texture-source', createTextureSourceNode);
  registry.register('color-source', createColorSourceNode);
  registry.register('gradient-source', createGradientSourceNode);

  // Effects
  registry.register('brightness', createBrightnessNode);
  registry.register('contrast', createContrastNode);
  registry.register('saturation', createSaturationNode);
  registry.register('opacity', createOpacityNode);
  registry.register('brightness-contrast', createBrightnessContrastNode);

  // Blur
  registry.register('blur', createBlurNode);
  registry.register('gaussian-blur', createGaussianBlurNode);
  registry.register('fast-blur', createFastBlurNode);

  // Output
  registry.register('output', createOutputNode);
  registry.register('export-output', createExportOutputNode);
  registry.register('preview-output', createPreviewOutputNode);
}
```

**Step 2: Write test for node registration**

Create `src/features/gpu/graph/nodes/index.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from '../node-registry';
import { registerBuiltinNodes } from './index';

describe('Built-in Node Registration', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
    registerBuiltinNodes(registry);
  });

  it('should register source nodes', () => {
    expect(registry.has('texture-source')).toBe(true);
    expect(registry.has('color-source')).toBe(true);
    expect(registry.has('gradient-source')).toBe(true);
  });

  it('should register effect nodes', () => {
    expect(registry.has('brightness')).toBe(true);
    expect(registry.has('contrast')).toBe(true);
    expect(registry.has('saturation')).toBe(true);
    expect(registry.has('opacity')).toBe(true);
    expect(registry.has('brightness-contrast')).toBe(true);
  });

  it('should register blur nodes', () => {
    expect(registry.has('blur')).toBe(true);
    expect(registry.has('gaussian-blur')).toBe(true);
    expect(registry.has('fast-blur')).toBe(true);
  });

  it('should register output nodes', () => {
    expect(registry.has('output')).toBe(true);
    expect(registry.has('export-output')).toBe(true);
    expect(registry.has('preview-output')).toBe(true);
  });

  it('should create nodes from registry', () => {
    const brightness = registry.create('brightness', 'b-1', { brightness: 0.3 });
    expect(brightness.name).toBe('Brightness');
    expect(brightness.params.brightness.value).toBe(0.3);

    const blur = registry.create('blur', 'blur-1', { radius: 5 });
    expect(blur.name).toBe('Blur');
    expect(blur.params.radius.value).toBe(5);
  });
});
```

**Step 3: Create graph module index**

Create `src/features/gpu/graph/index.ts`:
```typescript
/**
 * Shader Graph Module
 *
 * Node-based shader graph system for building GPU effect pipelines.
 */

// Types
export type {
  ShaderNode,
  NodeInput,
  NodeOutput,
  Connection,
  ConnectionEndpoint,
  ShaderGraph,
  CompiledPass,
  NodeType,
  DataType,
  ParamType,
  ParamDef,
  WGSLFragment,
  NodeFactory,
  NodeRegistry as INodeRegistry,
} from './types';

// Graph builder
export { ShaderGraphBuilder } from './shader-graph';

// Node registry
export { NodeRegistry, globalRegistry } from './node-registry';

// Built-in nodes
export * from './nodes';
```

**Step 4: Run tests**

Run: `npm run test:run -- src/features/gpu/graph/`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/features/gpu/graph/nodes/index.ts src/features/gpu/graph/nodes/index.test.ts src/features/gpu/graph/index.ts
git commit -m "feat(gpu): add node index and built-in node registration"
```

---

## Task 9: Create Graph Compiler

**Files:**
- Create: `src/features/gpu/graph/compiler.ts`
- Create: `src/features/gpu/graph/compiler.test.ts`

**Step 1: Write the test**

Create `src/features/gpu/graph/compiler.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphCompiler } from './compiler';
import { ShaderGraphBuilder } from './shader-graph';
import { createTextureSourceNode } from './nodes/source-node';
import { createBrightnessNode, createContrastNode } from './nodes/effect-nodes';
import { createOutputNode } from './nodes/output-node';

describe('GraphCompiler', () => {
  let compiler: GraphCompiler;
  let graph: ShaderGraphBuilder;

  beforeEach(() => {
    compiler = new GraphCompiler();
    graph = new ShaderGraphBuilder();
  });

  it('should compile a simple linear graph', () => {
    // Source -> Brightness -> Output
    graph.addNode(createTextureSourceNode('source-1'));
    graph.addNode(createBrightnessNode('brightness-1'));
    graph.addNode(createOutputNode('output-1'));

    graph.connect('source-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'output-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    expect(passes.length).toBeGreaterThan(0);
    // Should have at least one effect pass
    expect(passes.some(p => p.nodes.includes('brightness-1'))).toBe(true);
  });

  it('should compile a chain of effects', () => {
    // Source -> Brightness -> Contrast -> Output
    graph.addNode(createTextureSourceNode('source-1'));
    graph.addNode(createBrightnessNode('brightness-1'));
    graph.addNode(createContrastNode('contrast-1'));
    graph.addNode(createOutputNode('output-1'));

    graph.connect('source-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'contrast-1', 'input');
    graph.connect('contrast-1', 'output', 'output-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    // Effects should be in correct order
    const brightnessPass = passes.findIndex(p => p.nodes.includes('brightness-1'));
    const contrastPass = passes.findIndex(p => p.nodes.includes('contrast-1'));

    expect(brightnessPass).toBeLessThan(contrastPass);
  });

  it('should track input/output textures', () => {
    graph.addNode(createTextureSourceNode('source-1'));
    graph.addNode(createBrightnessNode('brightness-1'));
    graph.addNode(createOutputNode('output-1'));

    graph.connect('source-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'output-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    // Effect pass should have source as input
    const effectPass = passes.find(p => p.nodes.includes('brightness-1'));
    expect(effectPass?.inputs).toContain('source-1');
  });

  it('should mark final pass as screen output', () => {
    graph.addNode(createTextureSourceNode('source-1'));
    graph.addNode(createOutputNode('output-1'));

    graph.connect('source-1', 'output', 'output-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    const lastPass = passes[passes.length - 1];
    expect(lastPass.output).toBe('screen');
  });

  it('should collect uniforms from node params', () => {
    graph.addNode(createTextureSourceNode('source-1'));
    graph.addNode(createBrightnessNode('brightness-1', { brightness: 0.5 }));
    graph.addNode(createOutputNode('output-1'));

    graph.connect('source-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'output-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    const effectPass = passes.find(p => p.nodes.includes('brightness-1'));
    expect(effectPass?.uniforms.brightness).toBe(0.5);
  });
});
```

**Step 2: Implement GraphCompiler**

Create `src/features/gpu/graph/compiler.ts`:
```typescript
/**
 * Graph Compiler
 *
 * Compiles a shader graph into executable render passes.
 */

import type { ShaderGraph, ShaderNode, CompiledPass, Connection } from './types';

/**
 * Compiles shader graphs into render passes
 */
export class GraphCompiler {
  /**
   * Compile a shader graph into render passes
   */
  compile(graph: ShaderGraph): CompiledPass[] {
    const passes: CompiledPass[] = [];
    const sorted = this.topologicalSort(graph);

    // Group nodes into passes
    // For now, each effect node gets its own pass
    // Future optimization: merge compatible adjacent effects

    let passIndex = 0;
    let previousOutput: string | null = null;

    for (const node of sorted) {
      if (node.type === 'source') {
        // Source nodes don't create passes, they provide textures
        previousOutput = node.id;
        continue;
      }

      if (node.type === 'output') {
        // Output node - mark the final pass as screen output
        if (passes.length > 0) {
          passes[passes.length - 1].output = 'screen';
        } else {
          // Direct source to output - create a blit pass
          passes.push({
            id: `pass-${passIndex++}`,
            nodes: [node.id],
            shader: this.generateBlitShader(),
            inputs: previousOutput ? [previousOutput] : [],
            output: 'screen',
            uniforms: {},
          });
        }
        continue;
      }

      if (node.type === 'effect') {
        // Create a pass for this effect
        const inputs = this.getNodeInputs(node, graph);
        const uniforms = this.collectUniforms(node);

        passes.push({
          id: `pass-${passIndex++}`,
          nodes: [node.id],
          shader: node.shader?.code ?? '',
          inputs: inputs.length > 0 ? inputs : (previousOutput ? [previousOutput] : []),
          output: `temp-${passIndex}`,
          uniforms,
        });

        previousOutput = node.id;
      }
    }

    return passes;
  }

  /**
   * Topologically sort graph nodes
   */
  private topologicalSort(graph: ShaderGraph): ShaderNode[] {
    const result: ShaderNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error('Cycle detected in graph');
      }

      visiting.add(nodeId);

      // Visit dependencies first
      const inputConns = graph.connections.filter(c => c.to.nodeId === nodeId);
      for (const conn of inputConns) {
        visit(conn.from.nodeId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) result.push(node);
    };

    for (const nodeId of graph.nodes.keys()) {
      visit(nodeId);
    }

    return result;
  }

  /**
   * Get input node IDs for a node
   */
  private getNodeInputs(node: ShaderNode, graph: ShaderGraph): string[] {
    const inputConns = graph.connections.filter(c => c.to.nodeId === node.id);
    return inputConns.map(c => c.from.nodeId);
  }

  /**
   * Collect uniform values from node params
   */
  private collectUniforms(node: ShaderNode): Record<string, unknown> {
    const uniforms: Record<string, unknown> = {};

    for (const [key, param] of Object.entries(node.params)) {
      uniforms[key] = param.value;
    }

    return uniforms;
  }

  /**
   * Generate a simple blit shader for pass-through
   */
  private generateBlitShader(): string {
    return `
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;

@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(inputTexture, inputSampler, uv);
}
`;
  }
}

/**
 * Global compiler instance
 */
export const globalCompiler = new GraphCompiler();
```

**Step 3: Run test**

Run: `npm run test:run -- src/features/gpu/graph/compiler.test.ts`
Expected: PASS

**Step 4: Update graph index**

Add compiler to `src/features/gpu/graph/index.ts`:
```typescript
// Add to exports
export { GraphCompiler, globalCompiler } from './compiler';
```

**Step 5: Commit**

```bash
git add src/features/gpu/graph/compiler.ts src/features/gpu/graph/compiler.test.ts src/features/gpu/graph/index.ts
git commit -m "feat(gpu): add graph compiler for render passes"
```

---

## Task 10: Integration Tests and Module Export

**Files:**
- Create: `src/features/gpu/graph/integration.test.ts`
- Update: `src/features/gpu/index.ts`

**Step 1: Write integration test**

Create `src/features/gpu/graph/integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShaderGraphBuilder,
  GraphCompiler,
  NodeRegistry,
  registerBuiltinNodes,
} from './index';

describe('Shader Graph Integration', () => {
  let registry: NodeRegistry;
  let compiler: GraphCompiler;

  beforeEach(() => {
    registry = new NodeRegistry();
    registerBuiltinNodes(registry);
    compiler = new GraphCompiler();
  });

  it('should build and compile a complete effect chain', () => {
    const graph = new ShaderGraphBuilder();

    // Build graph using registry
    graph.addNode(registry.create('texture-source', 'src-1'));
    graph.addNode(registry.create('brightness', 'brightness-1', { brightness: 0.2 }));
    graph.addNode(registry.create('contrast', 'contrast-1', { contrast: 0.1 }));
    graph.addNode(registry.create('saturation', 'saturation-1', { saturation: 0.3 }));
    graph.addNode(registry.create('output', 'out-1'));

    // Connect nodes
    graph.connect('src-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'contrast-1', 'input');
    graph.connect('contrast-1', 'output', 'saturation-1', 'input');
    graph.connect('saturation-1', 'output', 'out-1', 'input');

    // Compile
    const passes = compiler.compile(graph.toGraph());

    // Verify passes
    expect(passes.length).toBeGreaterThanOrEqual(3);
    expect(passes[passes.length - 1].output).toBe('screen');

    // Check uniforms
    const brightnessPass = passes.find(p => p.nodes.includes('brightness-1'));
    expect(brightnessPass?.uniforms.brightness).toBe(0.2);
  });

  it('should handle blur in effect chain', () => {
    const graph = new ShaderGraphBuilder();

    graph.addNode(registry.create('texture-source', 'src-1'));
    graph.addNode(registry.create('blur', 'blur-1', { radius: 5 }));
    graph.addNode(registry.create('output', 'out-1'));

    graph.connect('src-1', 'output', 'blur-1', 'input');
    graph.connect('blur-1', 'output', 'out-1', 'input');

    const passes = compiler.compile(graph.toGraph());

    const blurPass = passes.find(p => p.nodes.includes('blur-1'));
    expect(blurPass).toBeDefined();
    expect(blurPass?.uniforms.radius).toBe(5);
  });

  it('should allow updating node params after creation', () => {
    const graph = new ShaderGraphBuilder();

    graph.addNode(registry.create('texture-source', 'src-1'));
    graph.addNode(registry.create('brightness', 'brightness-1'));
    graph.addNode(registry.create('output', 'out-1'));

    graph.connect('src-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'out-1', 'input');

    // Update brightness
    graph.updateNodeParams('brightness-1', { brightness: 0.75 });

    const passes = compiler.compile(graph.toGraph());
    const brightnessPass = passes.find(p => p.nodes.includes('brightness-1'));
    expect(brightnessPass?.uniforms.brightness).toBe(0.75);
  });

  it('should serialize and deserialize graph', () => {
    const graph = new ShaderGraphBuilder('test-graph');

    graph.addNode(registry.create('texture-source', 'src-1'));
    graph.addNode(registry.create('brightness', 'brightness-1', { brightness: 0.5 }));
    graph.addNode(registry.create('output', 'out-1'));

    graph.connect('src-1', 'output', 'brightness-1', 'input');
    graph.connect('brightness-1', 'output', 'out-1', 'input');

    // Serialize
    const json = graph.toJSON();

    // Deserialize
    const restored = ShaderGraphBuilder.fromJSON(json);

    expect(restored.getNodes().length).toBe(3);
    expect(restored.getConnections().length).toBe(2);
    expect(restored.getNode('brightness-1')?.params.brightness.value).toBe(0.5);
  });
});
```

**Step 2: Update main module index**

Update `src/features/gpu/index.ts`:
```typescript
/**
 * GPU Rendering Module
 *
 * WebGPU/WebGL2/Canvas rendering abstraction layer for FreeCut.
 */

// Backend exports
export * from './backend';

// Hook exports
export * from './hooks';

// Graph exports
export * from './graph';
```

**Step 3: Run all tests**

Run: `npm run test:run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/features/gpu/graph/integration.test.ts src/features/gpu/index.ts
git commit -m "feat(gpu): add graph integration tests and complete module export"
```

---

## Phase 2 Complete

You now have:
- ✅ Core graph type definitions
- ✅ Node registry for creating node instances
- ✅ ShaderGraphBuilder for constructing graphs
- ✅ Source nodes (texture, color, gradient)
- ✅ Effect nodes (brightness, contrast, saturation, opacity)
- ✅ Blur nodes (box blur, gaussian, fast blur)
- ✅ Output nodes (screen, export, preview)
- ✅ Graph compiler (nodes → render passes)
- ✅ Integration tests

**Next Phase:** Render Graph + Compositing - Resource pool, pass merging, multi-layer compositing.
