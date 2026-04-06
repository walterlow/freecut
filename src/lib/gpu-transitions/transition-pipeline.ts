import { createLogger } from '@/shared/logging/logger';
import { TRANSITION_COMMON_WGSL } from './common';
import type { GpuTransitionDefinition, GpuTransitionExternalSource } from './types';
import { GPU_TRANSITION_REGISTRY, getGpuTransition } from './index';

function getLogger() { return createLogger('TransitionPipeline'); }

const EXTERNAL_SOURCE_UNIFORM_BYTE_SIZE = 80;

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
  private externalPipelines = new Map<string, GPURenderPipeline>();
  private transformedExternalPipelines = new Map<string, GPURenderPipeline>();
  private bindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private externalBindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private transformedExternalBindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private uniformBuffers = new Map<string, GPUBuffer>();
  private leftSourceUniformBuffers = new Map<string, GPUBuffer>();
  private rightSourceUniformBuffers = new Map<string, GPUBuffer>();
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
    const shaderCode = `${TRANSITION_COMMON_WGSL}\n${def.shader}`;

    try {
      const shaderModule = this.device.createShaderModule({ label: `transition-${id}`, code: shaderCode });

      // Log shader compilation errors (one-time at init, not per-frame)
      shaderModule.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
          if (msg.type === 'error') {
            getLogger().error(`Shader "${id}" error at line ${msg.lineNum}:${msg.linePos}: ${msg.message}`);
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
      getLogger().warn(`Failed to create pipeline for "${id}"`, e);
      return;
    }

    try {
      const externalShaderModule = this.device.createShaderModule({
        label: `transition-${id}-external`,
        code: buildExternalTransitionShader(shaderCode),
      });

      const externalEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
      ];
      if (def.uniformSize > 0) {
        externalEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      }
      const externalBindGroupLayout = this.device.createBindGroupLayout({
        label: `transition-${id}-external-layout`,
        entries: externalEntries,
      });
      this.externalBindGroupLayouts.set(id, externalBindGroupLayout);

      const externalPipeline = this.device.createRenderPipeline({
        label: `transition-${id}-external-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [externalBindGroupLayout] }),
        vertex: { module: externalShaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: externalShaderModule,
          entryPoint: def.entryPoint,
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });
      this.externalPipelines.set(id, externalPipeline);
    } catch (e) {
      getLogger().warn(`Failed to create external pipeline for "${id}"`, e);
    }

    try {
      const transformedExternalShaderModule = this.device.createShaderModule({
        label: `transition-${id}-external-transformed`,
        code: buildTransformedExternalTransitionShader(shaderCode),
      });
      const transformedEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
      ];
      if (def.uniformSize > 0) {
        transformedEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      }
      transformedEntries.push(
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      );
      const transformedExternalBindGroupLayout = this.device.createBindGroupLayout({
        label: `transition-${id}-external-transformed-layout`,
        entries: transformedEntries,
      });
      this.transformedExternalBindGroupLayouts.set(id, transformedExternalBindGroupLayout);

      const transformedExternalPipeline = this.device.createRenderPipeline({
        label: `transition-${id}-external-transformed-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [transformedExternalBindGroupLayout] }),
        vertex: { module: transformedExternalShaderModule, entryPoint: 'vertexMain' },
        fragment: {
          module: transformedExternalShaderModule,
          entryPoint: def.entryPoint,
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });
      this.transformedExternalPipelines.set(id, transformedExternalPipeline);
    } catch (e) {
      getLogger().warn(`Failed to create transformed external pipeline for "${id}"`, e);
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

  private getOrCreateSourceUniformBuffer(
    buffers: Map<string, GPUBuffer>,
    id: string,
  ): GPUBuffer {
    let buf = buffers.get(id);
    if (buf && buf.size >= EXTERNAL_SOURCE_UNIFORM_BYTE_SIZE) return buf;
    buf?.destroy();
    buf = this.device.createBuffer({
      size: EXTERNAL_SOURCE_UNIFORM_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    buffers.set(id, buf);
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

    // Upload left and right canvases to GPU textures.
    // Canvas 2D stores premultiplied alpha — tell the GPU to keep it as-is
    // so the shader operates on premultiplied data matching the output canvas.
    this.device.queue.copyExternalImageToTexture(
      { source: leftCanvas, flipY: false },
      { texture: this.leftTexture, premultipliedAlpha: true },
      { width, height },
    );
    this.device.queue.copyExternalImageToTexture(
      { source: rightCanvas, flipY: false },
      { texture: this.rightTexture, premultipliedAlpha: true },
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

  renderVideoElements(
    transitionId: string,
    leftVideo: HTMLVideoElement | VideoFrame,
    rightVideo: HTMLVideoElement | VideoFrame,
    progress: number,
    width: number,
    height: number,
    direction?: string,
    properties?: Record<string, unknown>,
  ): OffscreenCanvas | null {
    const pipeline = this.externalPipelines.get(transitionId);
    const layout = this.externalBindGroupLayouts.get(transitionId);
    const def = getGpuTransition(transitionId);
    if (!pipeline || !layout || !def) return null;
    if (width < 2 || height < 2) return null;
    const leftW = leftVideo instanceof VideoFrame ? leftVideo.displayWidth : leftVideo.videoWidth;
    const rightW = rightVideo instanceof VideoFrame ? rightVideo.displayWidth : rightVideo.videoWidth;
    if (leftW < 2 || rightW < 2) {
      return null;
    }

    if (!this.outputCanvas || this.outputCanvas.width !== width || this.outputCanvas.height !== height) {
      this.outputCanvas = new OffscreenCanvas(width, height);
      const ctx = this.outputCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
      this.outputCtx = ctx;
    }
    if (!this.outputCtx) return null;

    let leftExternal: GPUExternalTexture;
    let rightExternal: GPUExternalTexture;
    try {
      leftExternal = this.device.importExternalTexture({ source: leftVideo });
      rightExternal = this.device.importExternalTexture({ source: rightVideo });
    } catch {
      return null;
    }

    const dirNum = directionToNumber(direction);
    const uniformData = def.packUniforms(progress, width, height, dirNum, properties);
    const uniformBuffer = this.getOrCreateUniformBuffer(transitionId, uniformData.byteLength);
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);

    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: leftExternal },
      { binding: 2, resource: rightExternal },
    ];
    if (def.uniformSize > 0) {
      bindEntries.push({ binding: 3, resource: { buffer: uniformBuffer } });
    }
    const bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });

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

  renderVideoElementsWithTransforms(
    transitionId: string,
    leftVideo: HTMLVideoElement | VideoFrame,
    rightVideo: HTMLVideoElement | VideoFrame,
    leftSource: GpuTransitionExternalSource,
    rightSource: GpuTransitionExternalSource,
    progress: number,
    width: number,
    height: number,
    direction?: string,
    properties?: Record<string, unknown>,
  ): OffscreenCanvas | null {
    const pipeline = this.transformedExternalPipelines.get(transitionId);
    const layout = this.transformedExternalBindGroupLayouts.get(transitionId);
    const def = getGpuTransition(transitionId);
    if (!pipeline || !layout || !def) return null;
    if (width < 2 || height < 2) return null;
    const leftW = leftVideo instanceof VideoFrame ? leftVideo.displayWidth : leftVideo.videoWidth;
    const rightW = rightVideo instanceof VideoFrame ? rightVideo.displayWidth : rightVideo.videoWidth;
    if (leftW < 2 || rightW < 2) {
      return null;
    }

    if (!this.outputCanvas || this.outputCanvas.width !== width || this.outputCanvas.height !== height) {
      this.outputCanvas = new OffscreenCanvas(width, height);
      const ctx = this.outputCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) return null;
      ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
      this.outputCtx = ctx;
    }
    if (!this.outputCtx) return null;

    let leftExternal: GPUExternalTexture;
    let rightExternal: GPUExternalTexture;
    try {
      leftExternal = this.device.importExternalTexture({ source: leftVideo });
      rightExternal = this.device.importExternalTexture({ source: rightVideo });
    } catch {
      return null;
    }

    const dirNum = directionToNumber(direction);
    const uniformData = def.packUniforms(progress, width, height, dirNum, properties);
    const uniformBuffer = this.getOrCreateUniformBuffer(transitionId, uniformData.byteLength);
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);

    const leftSourceUniformBuffer = this.getOrCreateSourceUniformBuffer(this.leftSourceUniformBuffers, transitionId);
    const rightSourceUniformBuffer = this.getOrCreateSourceUniformBuffer(this.rightSourceUniformBuffers, transitionId);
    this.device.queue.writeBuffer(leftSourceUniformBuffer, 0, packExternalSourceUniform(leftSource).buffer);
    this.device.queue.writeBuffer(rightSourceUniformBuffer, 0, packExternalSourceUniform(rightSource).buffer);

    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: this.sampler },
      { binding: 1, resource: leftExternal },
      { binding: 2, resource: rightExternal },
    ];
    if (def.uniformSize > 0) {
      bindEntries.push({ binding: 3, resource: { buffer: uniformBuffer } });
    }
    bindEntries.push(
      { binding: 4, resource: { buffer: leftSourceUniformBuffer } },
      { binding: 5, resource: { buffer: rightSourceUniformBuffer } },
    );
    const bindGroup = this.device.createBindGroup({ layout, entries: bindEntries });

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
    for (const buf of this.leftSourceUniformBuffers.values()) {
      buf.destroy();
    }
    this.leftSourceUniformBuffers.clear();
    for (const buf of this.rightSourceUniformBuffers.values()) {
      buf.destroy();
    }
    this.rightSourceUniformBuffers.clear();
    this.cachedBindGroups.clear();
    this.pipelines.clear();
    this.externalPipelines.clear();
    this.transformedExternalPipelines.clear();
    this.bindGroupLayouts.clear();
    this.externalBindGroupLayouts.clear();
    this.transformedExternalBindGroupLayouts.clear();
    this.initialized = false;
  }
}

function buildExternalTransitionShader(shaderCode: string): string {
  return shaderCode
    .replace(
      /@group\(0\)\s*@binding\(1\)\s*var\s+leftTex:\s*texture_2d<f32>;/g,
      '@group(0) @binding(1) var leftTex: texture_external;',
    )
    .replace(
      /@group\(0\)\s*@binding\(2\)\s*var\s+rightTex:\s*texture_2d<f32>;/g,
      '@group(0) @binding(2) var rightTex: texture_external;',
    )
    .replace(
      /textureSample\(\s*leftTex\s*,\s*texSampler\s*,/g,
      'textureSampleBaseClampToEdge(leftTex, texSampler,',
    )
    .replace(
      /textureSample\(\s*rightTex\s*,\s*texSampler\s*,/g,
      'textureSampleBaseClampToEdge(rightTex, texSampler,',
    );
}

function buildTransformedExternalTransitionShader(shaderCode: string): string {
  return shaderCode
    .replace(
      /@group\(0\)\s*@binding\(1\)\s*var\s+leftTex:\s*texture_2d<f32>;/g,
      '@group(0) @binding(1) var leftTex: texture_external;',
    )
    .replace(
      /@group\(0\)\s*@binding\(2\)\s*var\s+rightTex:\s*texture_2d<f32>;/g,
      '@group(0) @binding(2) var rightTex: texture_external;',
    )
    .replace(
      /(@group\(0\)\s*@binding\(3\)\s*var<uniform>\s+params:\s*[^;]+;)/g,
      `$1
struct TransitionExternalSource {
  mediaRect: vec4f,
  visibleRect: vec4f,
  featherInsets: vec4f,
  itemRect: vec4f,
  transform: vec4f,
};
@group(0) @binding(4) var<uniform> leftSource: TransitionExternalSource;
@group(0) @binding(5) var<uniform> rightSource: TransitionExternalSource;

fn inverseRotatePoint(point: vec2f, center: vec2f, angleRadians: f32) -> vec2f {
  let s = sin(angleRadians);
  let c = cos(angleRadians);
  let delta = point - center;
  return vec2f(
    delta.x * c + delta.y * s,
    -delta.x * s + delta.y * c,
  ) + center;
}

fn roundedRectMask(localPoint: vec2f, size: vec2f, radius: f32) -> f32 {
  if (radius <= 0.0) {
    return 1.0;
  }
  if (localPoint.x < 0.0 || localPoint.y < 0.0 || localPoint.x > size.x || localPoint.y > size.y) {
    return 0.0;
  }
  let r = min(radius, min(size.x, size.y) * 0.5);
  let innerMin = vec2f(r, r);
  let innerMax = size - vec2f(r, r);
  let nearest = clamp(localPoint, innerMin, innerMax);
  let delta = localPoint - nearest;
  return select(0.0, 1.0, dot(delta, delta) <= r * r);
}

fn sampleTransitionSource(
  tex: texture_external,
  uv: vec2f,
  source: TransitionExternalSource,
) -> vec4f {
  let canvasSize = vec2f(max(params.width, 1.0), max(params.height, 1.0));
  let pixel = uv * canvasSize;
  let itemSize = max(source.itemRect.zw, vec2f(0.0001, 0.0001));
  let center = source.itemRect.xy + itemSize * 0.5;
  let rotatedPixel = inverseRotatePoint(pixel, center, source.transform.y * PI / 180.0);
  let localPixel = rotatedPixel - source.itemRect.xy;
  let inItem = localPixel.x >= 0.0 && localPixel.x <= itemSize.x && localPixel.y >= 0.0 && localPixel.y <= itemSize.y;

  let mediaSize = max(source.mediaRect.zw, vec2f(0.0001, 0.0001));
  let rawVideoUv = (rotatedPixel - source.mediaRect.xy) / mediaSize;
  let videoUv = clamp(rawVideoUv, vec2f(0.0), vec2f(1.0));
  let inMedia = rotatedPixel.x >= source.mediaRect.x
    && rotatedPixel.x <= source.mediaRect.x + source.mediaRect.z
    && rotatedPixel.y >= source.mediaRect.y
    && rotatedPixel.y <= source.mediaRect.y + source.mediaRect.w;
  let inVisible = rotatedPixel.x >= source.visibleRect.x
    && rotatedPixel.x <= source.visibleRect.x + source.visibleRect.z
    && rotatedPixel.y >= source.visibleRect.y
    && rotatedPixel.y <= source.visibleRect.y + source.visibleRect.w;

  var featherMask = 1.0;
  if (source.featherInsets.x > 0.0) {
    featherMask = featherMask * smoothstep(
      source.visibleRect.x,
      min(source.visibleRect.x + source.featherInsets.x, source.visibleRect.x + source.visibleRect.z),
      rotatedPixel.x,
    );
  }
  if (source.featherInsets.y > 0.0) {
    featherMask = featherMask * (1.0 - smoothstep(
      max(source.visibleRect.x + source.visibleRect.z - source.featherInsets.y, source.visibleRect.x),
      source.visibleRect.x + source.visibleRect.z,
      rotatedPixel.x,
    ));
  }
  if (source.featherInsets.z > 0.0) {
    featherMask = featherMask * smoothstep(
      source.visibleRect.y,
      min(source.visibleRect.y + source.featherInsets.z, source.visibleRect.y + source.visibleRect.w),
      rotatedPixel.y,
    );
  }
  if (source.featherInsets.w > 0.0) {
    featherMask = featherMask * (1.0 - smoothstep(
      max(source.visibleRect.y + source.visibleRect.w - source.featherInsets.w, source.visibleRect.y),
      source.visibleRect.y + source.visibleRect.w,
      rotatedPixel.y,
    ));
  }

  let visibleMask = select(0.0, featherMask, inItem && inMedia && inVisible);
  let cornerMask = roundedRectMask(localPixel, itemSize, source.transform.z);
  return textureSampleBaseClampToEdge(tex, texSampler, videoUv) * (visibleMask * cornerMask * source.transform.x);
}

fn sampleLeft(uv: vec2f) -> vec4f {
  return sampleTransitionSource(leftTex, uv, leftSource);
}

fn sampleRight(uv: vec2f) -> vec4f {
  return sampleTransitionSource(rightTex, uv, rightSource);
}
`,
    )
    .replace(
      /textureSample\(\s*leftTex\s*,\s*texSampler\s*,/g,
      'sampleLeft(',
    )
    .replace(
      /textureSample\(\s*rightTex\s*,\s*texSampler\s*,/g,
      'sampleRight(',
    );
}

function packExternalSourceUniform(source: GpuTransitionExternalSource): Float32Array {
  return new Float32Array([
    source.mediaRect.x,
    source.mediaRect.y,
    source.mediaRect.width,
    source.mediaRect.height,
    source.visibleRect.x,
    source.visibleRect.y,
    source.visibleRect.width,
    source.visibleRect.height,
    source.featherInsets.left,
    source.featherInsets.right,
    source.featherInsets.top,
    source.featherInsets.bottom,
    source.itemRect.x,
    source.itemRect.y,
    source.itemRect.width,
    source.itemRect.height,
    source.opacity,
    source.rotation,
    source.cornerRadius,
    0,
  ]);
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
