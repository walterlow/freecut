type GpuMediaSource =
  | OffscreenCanvas
  | HTMLCanvasElement
  | HTMLVideoElement
  | HTMLImageElement
  | ImageBitmap
  | VideoFrame

export interface GpuMediaRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GpuMediaRenderParams {
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  sourceRect?: GpuMediaRect
  destRect: GpuMediaRect
  transformRect?: GpuMediaRect
  featherPixels?: {
    left: number
    right: number
    top: number
    bottom: number
  }
  cornerRadius?: number
  opacity?: number
  rotationRad?: number
  flipX?: boolean
  flipY?: boolean
}

const MEDIA_RENDER_SHADER = /* wgsl */ `
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

struct MediaUniforms {
  outputSize: vec2f,
  sourceSize: vec2f,
  sourceRect: vec4f,
  destRect: vec4f,
  opacity: f32,
  rotation: f32,
  flip: vec2f,
  transformRect: vec4f,
  feather: vec4f,
  mask: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: MediaUniforms;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * u.outputSize;
  let transformHalfSize = u.transformRect.zw * 0.5;
  let transformCenter = u.transformRect.xy + transformHalfSize;
  let relative = pixel - transformCenter;
  let cosR = cos(-u.rotation);
  let sinR = sin(-u.rotation);
  let transformLocal = vec2f(
    relative.x * cosR - relative.y * sinR,
    relative.x * sinR + relative.y * cosR
  );
  let unrotatedPixel = transformCenter + transformLocal;
  let destMin = u.destRect.xy;
  let destMax = u.destRect.xy + u.destRect.zw;
  if (unrotatedPixel.x < destMin.x || unrotatedPixel.y < destMin.y || unrotatedPixel.x > destMax.x || unrotatedPixel.y > destMax.y) {
    return vec4f(0.0);
  }

  var localUv = (unrotatedPixel - destMin) / max(u.destRect.zw, vec2f(0.001));
  if (u.flip.x < 0.0) {
    localUv.x = 1.0 - localUv.x;
  }
  if (u.flip.y < 0.0) {
    localUv.y = 1.0 - localUv.y;
  }
  let sourcePixel = u.sourceRect.xy + localUv * u.sourceRect.zw;
  let sourceUv = sourcePixel / max(u.sourceSize, vec2f(0.001));
  let color = textureSample(texSampler, sourceTex, sourceUv);
  let viewportLocal = unrotatedPixel - u.destRect.xy;
  let leftAlpha = select(1.0, clamp(viewportLocal.x / max(u.feather.x, 0.001), 0.0, 1.0), u.feather.x > 0.0);
  let rightAlpha = select(1.0, clamp((u.destRect.z - viewportLocal.x) / max(u.feather.y, 0.001), 0.0, 1.0), u.feather.y > 0.0);
  let topAlpha = select(1.0, clamp(viewportLocal.y / max(u.feather.z, 0.001), 0.0, 1.0), u.feather.z > 0.0);
  let bottomAlpha = select(1.0, clamp((u.destRect.w - viewportLocal.y) / max(u.feather.w, 0.001), 0.0, 1.0), u.feather.w > 0.0);
  let featherAlpha = leftAlpha * rightAlpha * topAlpha * bottomAlpha;

  let radius = min(u.mask.x, min(u.transformRect.z, u.transformRect.w) * 0.5);
  var cornerAlpha = 1.0;
  if (radius > 0.0) {
    let itemLocal = unrotatedPixel - u.transformRect.xy;
    let roundedDistance = length(max(abs(itemLocal - transformHalfSize) - (transformHalfSize - vec2f(radius)), vec2f(0.0))) - radius;
    cornerAlpha = 1.0 - smoothstep(-0.75, 0.75, roundedDistance);
  }

  return vec4f(color.rgb, color.a * u.opacity * featherAlpha * cornerAlpha);
}
`

function getGpuMediaSourceDimensions(source: GpuMediaSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  const sizedSource = source as HTMLCanvasElement | OffscreenCanvas | ImageBitmap
  return { width: sizedSource.width, height: sizedSource.height }
}

export class MediaRenderPipeline {
  private inputTexture: GPUTexture | null = null
  private inputView: GPUTextureView | null = null
  private bindGroup: GPUBindGroup | null = null
  private inputW = 0
  private inputH = 0
  private readonly pipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly bindGroupLayout: GPUBindGroupLayout
  private readonly uniformBuffer: GPUBuffer

  constructor(private readonly device: GPUDevice) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const shaderModule = device.createShaderModule({
      label: 'media-render',
      code: MEDIA_RENDER_SHADER,
    })
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'media-render-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    this.pipeline = device.createRenderPipeline({
      label: 'media-render-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.uniformBuffer = device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  renderSourceToTexture(
    source: GpuMediaSource,
    outputTexture: GPUTexture,
    params: GpuMediaRenderParams,
  ): boolean {
    const sourceSize = getGpuMediaSourceDimensions(source)
    const sourceWidth = params.sourceWidth || sourceSize.width
    const sourceHeight = params.sourceHeight || sourceSize.height
    if (sourceWidth < 2 || sourceHeight < 2) return false
    if (
      outputTexture.width !== params.outputWidth ||
      outputTexture.height !== params.outputHeight
    ) {
      return false
    }

    this.ensureInputTexture(sourceWidth, sourceHeight)
    if (!this.inputTexture || !this.inputView) return false

    this.device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this.inputTexture },
      { width: sourceWidth, height: sourceHeight },
    )

    const sourceRect = params.sourceRect ?? {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    }
    const transformRect = params.transformRect ?? params.destRect
    const featherPixels = params.featherPixels ?? { left: 0, right: 0, top: 0, bottom: 0 }
    const uniformData = new Float32Array([
      params.outputWidth,
      params.outputHeight,
      sourceWidth,
      sourceHeight,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      params.destRect.x,
      params.destRect.y,
      params.destRect.width,
      params.destRect.height,
      params.opacity ?? 1,
      params.rotationRad ?? 0,
      params.flipX ? -1 : 1,
      params.flipY ? -1 : 1,
      transformRect.x,
      transformRect.y,
      transformRect.width,
      transformRect.height,
      featherPixels.left,
      featherPixels.right,
      featherPixels.top,
      featherPixels.bottom,
      params.cornerRadius ?? 0,
      0,
      0,
      0,
    ])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData)

    const bindGroup = this.ensureBindGroup()
    if (!bindGroup) return false
    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  destroy(): void {
    this.inputTexture?.destroy()
    this.uniformBuffer.destroy()
  }

  private ensureInputTexture(width: number, height: number): void {
    if (this.inputTexture && this.inputW === width && this.inputH === height) return
    this.inputTexture?.destroy()
    this.inputTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.inputView = this.inputTexture.createView()
    this.bindGroup = null
    this.inputW = width
    this.inputH = height
  }

  private ensureBindGroup(): GPUBindGroup | null {
    if (this.bindGroup) return this.bindGroup
    if (!this.inputView) return null
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.inputView },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    })
    return this.bindGroup
  }
}
