/**
 * Graph Compiler
 *
 * Compiles a shader graph into executable render passes.
 */

import type { ShaderGraph, ShaderNode, CompiledPass } from './types';

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
          inputs: inputs.length > 0 ? inputs : previousOutput ? [previousOutput] : [],
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
      const inputConns = graph.connections.filter((c) => c.to.nodeId === nodeId);
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
    const inputConns = graph.connections.filter((c) => c.to.nodeId === node.id);
    return inputConns.map((c) => c.from.nodeId);
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
