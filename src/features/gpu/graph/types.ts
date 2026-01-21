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
  output?: string; // For 'from' endpoint
  input?: string; // For 'to' endpoint
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
  nodes: string[]; // Node IDs included in this pass
  shader: string; // Combined WGSL code
  inputs: string[]; // Input texture IDs
  output: string; // Output texture ID or 'screen'
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
