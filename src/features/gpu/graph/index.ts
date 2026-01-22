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
