/**
 * GPU Compositor Pipeline
 *
 * Composites layers with blend modes, transforms, opacity, and masks.
 * Uses ping-pong textures — each layer reads from input and writes to output,
 * then they swap. Final result is the last input texture.
 *
 * Three render pipelines:
 * 1. Regular — for GPUTexture inputs (images, pre-rendered canvases)
 * 2. External — for GPUExternalTexture inputs (zero-copy video)
 * 3. Blit — copies the final composite to a canvas, converting straight → premultiplied alpha
 */

import type { BlendMode } from '@/types/blend-modes';
import { BLEND_MODE_INDEX } from '@/types/blend-modes';
import { createLogger } from '@/shared/logging/logger';
import { BLEND_MODES_WGSL } from './blend-modes';

const logger = createLogger('CompositorPipeline');

// ─── Shader ───

const BLIT_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex
fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
    vec2f(-1,1), vec2f(1,-1), vec2f(1,1)
  );
  var uv = array<vec2f, 6>(
    vec2f(0,1), vec2f(1,1), vec2f(0,0),
    vec2f(0,0), vec2f(1,1), vec2f(1,0)
  );
  var o: VertexOutput;
  o.position = vec4f(pos[vi], 0, 1);
  o.uv = uv[vi];
  return o;
}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

@fragment
fn blitFragment(input: VertexOutput) -> @location(0) vec4f {
  // Composite textures store straight alpha; canvas expects premultiplied
  let c = textureSample(inputTex, texSampler, input.uv);
  return vec4f(c.rgb * c.a, c.a);
}
`;

const VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex
fn vertexMain(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
    vec2f(-1,1), vec2f(1,-1), vec2f(1,1)
  );
  var uv = array<vec2f, 6>(
    vec2f(0,1), vec2f(1,1), vec2f(0,0),
    vec2f(0,0), vec2f(1,1), vec2f(1,0)
  );
  var o: VertexOutput;
  o.position = vec4f(pos[vi], 0, 1);
  o.uv = uv[vi];
  return o;
}
`;

const COMPOSITE_UNIFORMS = /* wgsl */ `
struct CompositeUniforms {
  opacity: f32,            // 0
  blendMode: u32,          // 1
  posX: f32,               // 2
  posY: f32,               // 3
  scaleX: f32,             // 4
  scaleY: f32,             // 5
  rotationZ: f32,          // 6
  sourceAspect: f32,       // 7
  outputAspect: f32,       // 8
  time: f32,               // 9
  hasMask: u32,            // 10
  maskInvert: u32,         // 11
  rotationX: f32,          // 12
  rotationY: f32,          // 13
  perspective: f32,        // 14
  maskFeather: f32,        // 15
};
`;

const COMPOSITE_FRAGMENT = /* wgsl */ `
${BLEND_MODES_WGSL}
${COMPOSITE_UNIFORMS}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: CompositeUniforms;
@group(0) @binding(4) var maskTex: texture_2d<f32>;

fn transformUV(uv: vec2f) -> vec2f {
  // Center UV around origin
  var p = uv - vec2f(0.5);

  // Apply scale
  p /= vec2f(u.scaleX, u.scaleY);

  // Apply 2D rotation
  let cosR = cos(u.rotationZ);
  let sinR = sin(u.rotationZ);
  p = vec2f(p.x * cosR + p.y * sinR, -p.x * sinR + p.y * cosR);

  // Apply 3D perspective rotation (X and Y axis)
  if (u.perspective > 0.0) {
    let cosX = cos(u.rotationX);
    let sinX = sin(u.rotationX);
    let cosY = cos(u.rotationY);
    let sinY = sin(u.rotationY);

    // Y-axis rotation
    let pz = p.x * sinY;
    let px = p.x * cosY;
    // X-axis rotation
    let py = p.y * cosX - pz * sinX;
    let pzz = p.y * sinX + pz * cosX;

    // Perspective projection
    let w = 1.0 + pzz / u.perspective;
    if (w <= 0.001) { return vec2f(-1.0); } // behind camera
    p = vec2f(px, py) / w;
  }

  // Apply position offset
  p -= vec2f(u.posX, u.posY);

  // Correct aspect ratio
  p.x *= u.outputAspect / max(u.sourceAspect, 0.001);

  return p + vec2f(0.5);
}

@fragment
fn compositeFragment(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(baseTex, texSampler, input.uv);

  // Transform UV to sample layer texture
  let layerUV = transformUV(input.uv);

  // Out-of-bounds check
  if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
    return baseColor;
  }

  var layerColor = textureSample(layerTex, texSampler, layerUV);

  // Apply mask
  var maskValue = 1.0;
  if (u.hasMask != 0u) {
    maskValue = textureSample(maskTex, texSampler, layerUV).r;
    if (u.maskInvert != 0u) {
      maskValue = 1.0 - maskValue;
    }
  }

  let layerAlpha = layerColor.a * u.opacity * maskValue;
  if (layerAlpha <= 0.0) {
    return baseColor;
  }

  // Apply blend mode
  let blended = applyBlendMode(baseColor.rgb, layerColor.rgb, u.blendMode);

  // Standard over blend (straight alpha)
  let outRgb = mix(baseColor.rgb, blended, layerAlpha);
  let outAlpha = baseColor.a + layerAlpha * (1.0 - baseColor.a);

  return vec4f(outRgb, outAlpha);
}
`;

const COMPOSITE_EXTERNAL_FRAGMENT = /* wgsl */ `
${BLEND_MODES_WGSL}
${COMPOSITE_UNIFORMS}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_external;
@group(0) @binding(3) var<uniform> u: CompositeUniforms;
@group(0) @binding(4) var maskTex: texture_2d<f32>;

fn transformUV_ext(uv: vec2f) -> vec2f {
  var p = uv - vec2f(0.5);
  p /= vec2f(u.scaleX, u.scaleY);
  let cosR = cos(u.rotationZ);
  let sinR = sin(u.rotationZ);
  p = vec2f(p.x * cosR + p.y * sinR, -p.x * sinR + p.y * cosR);
  if (u.perspective > 0.0) {
    let cosX = cos(u.rotationX);
    let sinX = sin(u.rotationX);
    let cosY = cos(u.rotationY);
    let sinY = sin(u.rotationY);
    let pz = p.x * sinY;
    let px = p.x * cosY;
    let py = p.y * cosX - pz * sinX;
    let pzz = p.y * sinX + pz * cosX;
    let w = 1.0 + pzz / u.perspective;
    if (w <= 0.001) { return vec2f(-1.0); }
    p = vec2f(px, py) / w;
  }
  p -= vec2f(u.posX, u.posY);
  p.x *= u.outputAspect / max(u.sourceAspect, 0.001);
  return p + vec2f(0.5);
}

@fragment
fn compositeExternalFragment(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(baseTex, texSampler, input.uv);
  let layerUV = transformUV_ext(input.uv);
  if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
    return baseColor;
  }
  var layerColor = textureSampleBaseClampToEdge(layerTex, texSampler, layerUV);
  var maskValue = 1.0;
  if (u.hasMask != 0u) {
    maskValue = textureSample(maskTex, texSampler, layerUV).r;
    if (u.maskInvert != 0u) { maskValue = 1.0 - maskValue; }
  }
  let layerAlpha = layerColor.a * u.opacity * maskValue;
  if (layerAlpha <= 0.0) { return baseColor; }
  let blended = applyBlendMode(baseColor.rgb, layerColor.rgb, u.blendMode);
  let outRgb = mix(baseColor.rgb, blended, layerAlpha);
  let outAlpha = baseColor.a + layerAlpha * (1.0 - baseColor.a);
  return vec4f(outRgb, outAlpha);
}
`;

// ─── Uniform packing ───

const UNIFORM_SIZE = 64; // 16 floats × 4 bytes

export interface CompositeLayerParams {
  opacity: number;
  blendMode: BlendMode;
  posX: number;
  posY: number;
  scaleX: number;
  scaleY: number;
  rotationZ: number;
  sourceAspect: number;
  outputAspect: number;
  time: number;
  hasMask: boolean;
  maskInvert: boolean;
  rotationX: number;
  rotationY: number;
  perspective: number;
  maskFeather: number;
}

export const DEFAULT_LAYER_PARAMS: CompositeLayerParams = {
  opacity: 1,
  blendMode: 'normal',
  posX: 0,
  posY: 0,
  scaleX: 1,
  scaleY: 1,
  rotationZ: 0,
  sourceAspect: 16 / 9,
  outputAspect: 16 / 9,
  time: 0,
  hasMask: false,
  maskInvert: false,
  rotationX: 0,
  rotationY: 0,
  perspective: 0,
  maskFeather: 0,
};

function packUniforms(p: CompositeLayerParams): Float32Array {
  const buf = new Float32Array(16);
  buf[0] = p.opacity;
  // Store blend mode as u32 in float bits
  new Uint32Array(buf.buffer, 4, 1)[0] = BLEND_MODE_INDEX[p.blendMode] ?? 0;
  buf[2] = p.posX;
  buf[3] = p.posY;
  buf[4] = p.scaleX;
  buf[5] = p.scaleY;
  buf[6] = p.rotationZ;
  buf[7] = p.sourceAspect;
  buf[8] = p.outputAspect;
  buf[9] = p.time;
  new Uint32Array(buf.buffer, 40, 1)[0] = p.hasMask ? 1 : 0;
  new Uint32Array(buf.buffer, 44, 1)[0] = p.maskInvert ? 1 : 0;
  buf[12] = p.rotationX;
  buf[13] = p.rotationY;
  buf[14] = p.perspective;
  buf[15] = p.maskFeather;
  return buf;
}

// ─── Pipeline class ───

export class CompositorPipeline {
  private device: GPUDevice;
  private canvasFormat: GPUTextureFormat;
  private sampler: GPUSampler;
  private uniformBuffer: GPUBuffer;

  private regularPipeline: GPURenderPipeline | null = null;
  private regularLayout: GPUBindGroupLayout | null = null;

  private externalPipeline: GPURenderPipeline | null = null;
  private externalLayout: GPUBindGroupLayout | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private blitLayout: GPUBindGroupLayout | null = null;

  private pingTexture: GPUTexture | null = null;
  private pongTexture: GPUTexture | null = null;
  private pingView: GPUTextureView | null = null;
  private pongView: GPUTextureView | null = null;
  private texW = 0;
  private texH = 0;
  private blitBindGroupPing: GPUBindGroup | null = null;
  private blitBindGroupPong: GPUBindGroup | null = null;

  // Last packed uniforms for change detection
  private lastUniforms: Float32Array | null = null;

  constructor(device: GPUDevice) {
    this.device = device;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.createPipelines();
  }

  private createPipelines(): void {
    // Regular composite pipeline (texture_2d layer)
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-regular',
        code: VERTEX_SHADER + COMPOSITE_FRAGMENT,
      });
      this.regularLayout = this.device.createBindGroupLayout({
        label: 'compositor-regular-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      });
      this.regularPipeline = this.device.createRenderPipeline({
        label: 'compositor-regular-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.regularLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'compositeFragment', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
    } catch (e) {
      logger.warn('Failed to create regular compositor pipeline', e);
    }

    // External composite pipeline (texture_external layer — zero-copy video)
    try {
      const module = this.device.createShaderModule({
        label: 'compositor-external',
        code: VERTEX_SHADER + COMPOSITE_EXTERNAL_FRAGMENT,
      });
      this.externalLayout = this.device.createBindGroupLayout({
        label: 'compositor-external-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      });
      this.externalPipeline = this.device.createRenderPipeline({
        label: 'compositor-external-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.externalLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'compositeExternalFragment', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
    } catch {
      // importExternalTexture may not be supported
      this.externalPipeline = null;
      this.externalLayout = null;
    }

    try {
      const module = this.device.createShaderModule({
        label: 'compositor-blit',
        code: BLIT_SHADER,
      });
      this.blitLayout = this.device.createBindGroupLayout({
        label: 'compositor-blit-layout',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ],
      });
      this.blitPipeline = this.device.createRenderPipeline({
        label: 'compositor-blit-pipeline',
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blitLayout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'blitFragment', targets: [{ format: this.canvasFormat }] },
        primitive: { topology: 'triangle-list' },
      });
    } catch (e) {
      logger.warn('Failed to create compositor blit pipeline', e);
    }
  }

  private ensurePingPong(w: number, h: number): void {
    if (this.pingTexture && this.texW === w && this.texH === h) return;
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    const desc: GPUTextureDescriptor = {
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
             GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    };
    this.pingTexture = this.device.createTexture(desc);
    this.pongTexture = this.device.createTexture(desc);
    this.pingView = this.pingTexture.createView();
    this.pongView = this.pongTexture.createView();
    this.texW = w;
    this.texH = h;
    this.blitBindGroupPing = null;
    this.blitBindGroupPong = null;
  }

  private writeUniforms(params: CompositeLayerParams): void {
    const data = packUniforms(params);
    // Change detection: skip GPU write if unchanged
    if (this.lastUniforms && data.every((v, i) => v === this.lastUniforms![i])) {
      return;
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data.buffer);
    this.lastUniforms = data;
  }

  /**
   * Composite a sequence of layers onto a canvas.
   * Returns the result texture (ping or pong) containing the final composite.
   *
   * Layers are composited bottom-to-top. Each layer provides either a GPUTextureView
   * (for images/pre-rendered) or a GPUExternalTexture (for zero-copy video).
   */
  compositeToTexture(
    layers: CompositeLayer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
  ): { texture: GPUTexture; view: GPUTextureView } | null {
    if (layers.length === 0) return null;
    if (!this.regularPipeline || !this.regularLayout) return null;

    this.ensurePingPong(width, height);
    if (!this.pingTexture || !this.pongTexture) return null;

    // Clear ping to transparent black
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.pingView!,
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
    });
    clearPass.end();

    let inputTex = this.pingTexture;
    let outputTex = this.pongTexture;
    let inputView = this.pingView!;
    let outputView = this.pongView!;

    for (const layer of layers) {
      this.writeUniforms(layer.params);

      let bindGroup: GPUBindGroup;
      let pipeline: GPURenderPipeline;

      if (layer.externalTexture && this.externalPipeline && this.externalLayout) {
        // External video texture path
        pipeline = this.externalPipeline;
        bindGroup = this.device.createBindGroup({
          layout: this.externalLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: layer.externalTexture },
            { binding: 3, resource: { buffer: this.uniformBuffer } },
            { binding: 4, resource: layer.maskView },
          ],
        });
      } else if (layer.textureView) {
        // Regular texture path
        pipeline = this.regularPipeline;
        bindGroup = this.device.createBindGroup({
          layout: this.regularLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: inputView },
            { binding: 2, resource: layer.textureView },
            { binding: 3, resource: { buffer: this.uniformBuffer } },
            { binding: 4, resource: layer.maskView },
          ],
        });
      } else {
        continue; // Skip layers without a texture source
      }

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: outputView,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      // Swap ping/pong
      const tmpTex = inputTex;
      inputTex = outputTex;
      outputTex = tmpTex;
      const tmpView = inputView;
      inputView = outputView;
      outputView = tmpView;
    }

    return { texture: inputTex, view: inputView };
  }

  compositeToCanvas(
    layers: CompositeLayer[],
    width: number,
    height: number,
    outputCtx: GPUCanvasContext,
  ): boolean {
    if (!this.blitPipeline || !this.blitLayout) return false;

    const commandEncoder = this.device.createCommandEncoder();
    const composited = this.compositeToTexture(layers, width, height, commandEncoder);
    if (!composited) {
      return false;
    }

    const blitBindGroup = composited.texture === this.pingTexture
      ? (this.blitBindGroupPing ??= this.device.createBindGroup({
          layout: this.blitLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pingView! },
          ],
        }))
      : (this.blitBindGroupPong ??= this.device.createBindGroup({
          layout: this.blitLayout,
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.pongView! },
          ],
        }));

    const outputPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: outputCtx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    outputPass.setPipeline(this.blitPipeline);
    outputPass.setBindGroup(0, blitBindGroup);
    outputPass.draw(6);
    outputPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    return true;
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  destroy(): void {
    this.pingTexture?.destroy();
    this.pongTexture?.destroy();
    this.uniformBuffer.destroy();
    this.pingTexture = null;
    this.pongTexture = null;
    this.pingView = null;
    this.pongView = null;
    this.blitPipeline = null;
    this.blitLayout = null;
    this.blitBindGroupPing = null;
    this.blitBindGroupPong = null;
  }
}

/** A layer to be composited */
export interface CompositeLayer {
  params: CompositeLayerParams;
  /** Regular texture view (for images, pre-rendered canvases) */
  textureView?: GPUTextureView;
  /** External texture (for zero-copy video) */
  externalTexture?: GPUExternalTexture;
  /** Mask texture view (use MaskTextureManager.getFallbackView() if no mask) */
  maskView: GPUTextureView;
}
