import { TRANSITION_COMMON_WGSL } from './common';
import type { GpuTransitionDefinition } from './types';
import { GPU_TRANSITION_REGISTRY, getGpuTransition } from './index';

/**
 * GPU Transition Pipeline
 *
 * Renders transitions between two clip textures using WebGPU shaders.
 * Single-pass: transition shader renders directly to the output canvas.
 */
export class TransitionPipeline {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private sampler: GPUSampler;
  private pipelines = new Map<string, GPURenderPipeline>();
  private bindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private uniformBuffers = new Map<string, GPUBuffer>();
  private cachedBindGroups = new Map<string, GPUBindGroup>();

  // Input textures (left/right clip content)
  private leftTexture: GPUTexture | null = null;
  private rightTexture: GPUTexture | null = null;
  private leftView: GPUTextureView | null = null;
  private rightView: GPUTextureView | null = null;

  // Output canvas with WebGPU context
  private outputCanvas: OffscreenCanvas | null = null;
  private outputCtx: GPUCanvasContext | null = null;

  private texW = 0;
  private texH = 0;
  private initialized = false;

  private constructor(device: GPUDevice) {
    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  static create(device?: GPUDevice): TransitionPipeline | null {
    const dev = device;
    if (!dev) return null;
    try {
      const pipeline = new TransitionPipeline(dev);
      pipeline.init();
      return pipeline;
    } catch {
      return null;
    }
  }

  private init(): void {
    if (this.initialized) return;

    for (const [id, def] of GPU_TRANSITION_REGISTRY) {
      this.createTransitionPipeline(id, def);
    }

    this.initialized = true;
  }

  private createTransitionPipeline(id: string, def: GpuTransitionDefinition): void {
    try {
      const shaderCode = `${TRANSITION_COMMON_WGSL}\n${def.shader}`;
      const shaderModule = this.device.createShaderModule({ label: `transition-${id}`, code: shaderCode });

      // Log shader compilation errors (one-time at init, not per-frame)
      shaderModule.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
          if (msg.type === 'error') {
            console.error(`[TransitionPipeline] Shader "${id}" error at line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
          }
        }
      }).catch(() => { /* getCompilationInfo not supported */ });

      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ];
      if (def.uniformSize > 0) {
        entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      }

      const bindGroupLayout = this.device.createBindGroupLayout({ label: `transition-${id}-layout`, entries });
      this.bindGroupLayouts.set(id, bindGroupLayout);

      // Render directly to the output canvas format (single-pass, no intermediate blit)
      const pipeline = this.device.createRenderPipeline({
        label: `transition-${id}-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: shaderModule,
          entryPoint: def.entryPoint,
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });
      this.pipelines.set(id, pipeline);
    } catch (e) {
      console.warn(`[TransitionPipeline] Failed to create pipeline for "${id}"`, e);
    }
  }

  private ensureTextures(w: number, h: number): void {
    if (this.leftTexture && this.texW === w && this.texH === h) return;

    this.leftTexture?.destroy();
    this.rightTexture?.destroy();

    // copyExternalImageToTexture requires BOTH COPY_DST and RENDER_ATTACHMENT on destination
    const inputDesc: GPUTextureDescriptor = {
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    };
    this.leftTexture = this.device.createTexture(inputDesc);
    this.rightTexture = this.device.createTexture(inputDesc);
    this.leftView = this.leftTexture.createView();
    this.rightView = this.rightTexture.createView();

    // Invalidate cached bind groups (textures changed)
    this.cachedBindGroups.clear();

    this.texW = w;
    this.texH = h;
  }

  private getOrCreateUniformBuffer(id: string, size: number): GPUBuffer {
    let buf = this.uniformBuffers.get(id);
    if (buf && buf.size >= size) return buf;
    buf?.destroy();
    buf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBuffers.set(id, buf);
    return buf;
  }

  /**
   * Render a GPU transition.
   * Returns an OffscreenCanvas with the composited result, or null on failure.
   *
   * Single-pass: transition shader renders left+right directly to the output canvas.
   * Bind groups are cached and reused when texture size is unchanged.
   */
  render(
    transitionId: string,
    leftCanvas: OffscreenCanvas,
    rightCanvas: OffscreenCanvas,
    progress: number,
    width: number,
    height: number,
    direction?: string,
    properties?: Record<string, unknown>,
  ): OffscreenCanvas | null {
    const pipeline = this.pipelines.get(transitionId);
    const layout = this.bindGroupLayouts.get(transitionId);
    const def = getGpuTransition(transitionId);
    if (!pipeline || !layout || !def) return null;
    if (width < 2 || height < 2) return null;

    // Ensure textures (invalidates cached bind groups on resize)
    const sizeChanged = this.texW !== width || this.texH !== height;
    this.ensureTextures(width, height);
    if (!this.leftTexture || !this.rightTexture) return null;

    // Ensure output canvas
    if (!this.outputCanvas || this.outputCanvas.width !== width || this.outputCanvas.height !== height) {
      this.outputCanvas = new OffscreenCanvas(width, height);
      const ctx = this.outputCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
      this.outputCtx = ctx;
    }
    if (!this.outputCtx) return null;

    // Upload left and right canvases to GPU textures
    this.device.queue.copyExternalImageToTexture(
      { source: leftCanvas, flipY: false },
      { texture: this.leftTexture },
      { width, height },
    );
    this.device.queue.copyExternalImageToTexture(
      { source: rightCanvas, flipY: false },
      { texture: this.rightTexture },
      { width, height },
    );

    // Pack uniforms
    const dirNum = directionToNumber(direction);
    const uniformData = def.packUniforms(progress, width, height, dirNum, properties);
    const uniformBuffer = this.getOrCreateUniformBuffer(transitionId, uniformData.byteLength);
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);

    // Reuse cached bind group (only recreate on texture resize)
    let bindGroup = this.cachedBindGroups.get(transitionId);
    if (!bindGroup || sizeChanged) {
      const bindEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.leftView! },
        { binding: 2, resource: this.rightView! },
      ];
      if (def.uniformSize > 0) {
        bindEntries.push({ binding: 3, resource: { buffer: uniformBuffer } });
      }
      bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });
      this.cachedBindGroups.set(transitionId, bindGroup);
    }

    // Single-pass render directly to the output canvas
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.outputCtx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    return this.outputCanvas;
  }

  has(transitionId: string): boolean {
    return this.pipelines.has(transitionId);
  }

  destroy(): void {
    this.leftTexture?.destroy();
    this.rightTexture?.destroy();
    this.leftTexture = null;
    this.rightTexture = null;
    this.leftView = null;
    this.rightView = null;
    this.outputCanvas = null;
    this.outputCtx = null;
    for (const buf of this.uniformBuffers.values()) {
      buf.destroy();
    }
    this.uniformBuffers.clear();
    this.cachedBindGroups.clear();
    this.pipelines.clear();
    this.bindGroupLayouts.clear();
    this.initialized = false;
  }
}

function directionToNumber(direction?: string): number {
  switch (direction) {
    case 'from-left': return 0;
    case 'from-right': return 1;
    case 'from-top': return 2;
    case 'from-bottom': return 3;
    default: return 0;
  }
}
