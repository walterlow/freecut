import type { ShapeItem } from '@/types/timeline'

export interface GpuShapeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GpuShapeRenderParams {
  outputWidth: number
  outputHeight: number
  transformRect: GpuShapeRect
  rotationRad?: number
  opacity?: number
  shapeType: ShapeItem['shapeType']
  fillColor: [number, number, number, number]
  strokeColor?: [number, number, number, number]
  strokeWidth?: number
  cornerRadius?: number
  direction?: ShapeItem['direction']
  points?: number
  innerRadius?: number
  aspectRatioLocked?: boolean
  pathVertices?: Array<[number, number]>
  clear?: boolean
  blend?: boolean
  maskFeatherPixels?: number
}

export const MAX_GPU_SHAPE_PATH_VERTICES = 32
const SHAPE_UNIFORM_FLOAT_COUNT = 24 + MAX_GPU_SHAPE_PATH_VERTICES * 4

const SHAPE_RENDER_SHADER = /* wgsl */ `
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

struct ShapeUniforms {
  outputSize: vec2f,
  shapeKind: f32,
  opacity: f32,
  transformRect: vec4f,
  fillColor: vec4f,
  strokeColor: vec4f,
  shapeParams: vec4f,
  flags: vec4f,
  pathVertices: array<vec4f, 32>,
};

@group(0) @binding(0) var<uniform> u: ShapeUniforms;

fn sdBox(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  return sdBox(p, max(b - vec2f(r), vec2f(0.0))) - r;
}

fn sdEllipse(p: vec2f, r: vec2f) -> f32 {
  let q = p / max(r, vec2f(0.001));
  return (length(q) - 1.0) * min(r.x, r.y);
}

fn cross2(a: vec2f, b: vec2f) -> f32 {
  return a.x * b.y - a.y * b.x;
}

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn triangleSigned(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
  let edgeDistance = min(min(sdSegment(p, a, b), sdSegment(p, b, c)), sdSegment(p, c, a));
  let s0 = cross2(b - a, p - a);
  let s1 = cross2(c - b, p - b);
  let s2 = cross2(a - c, p - c);
  let hasNegative = s0 < 0.0 || s1 < 0.0 || s2 < 0.0;
  let hasPositive = s0 > 0.0 || s1 > 0.0 || s2 > 0.0;
  let outside = hasNegative && hasPositive;
  return select(-edgeDistance, edgeDistance, outside);
}

fn polarShapeDistance(p: vec2f, points: f32, innerRatio: f32, star: bool) -> f32 {
  let angle = atan2(p.y, p.x) + 1.57079632679;
  let n = max(points, 3.0);
  let outer = 1.0;
  let inner = clamp(innerRatio, 0.05, 0.95);
  let sector = 6.28318530718 / n;
  let local = abs(fract(angle / sector + 0.5) - 0.5) * sector;
  let edgeRadius = select(cos(3.14159265359 / n) / max(cos(local), 0.001), mix(inner, outer, local / (sector * 0.5)), star);
  return length(p) - edgeRadius;
}

fn heartDistance(p: vec2f) -> f32 {
  let q = vec2f(p.x, -p.y * 1.12 + 0.18);
  let a = q.x * q.x + q.y * q.y - 1.0;
  let implicit = a * a * a - q.x * q.x * q.y * q.y * q.y;
  return implicit * 18.0;
}

fn pathPolygonDistance(p: vec2f, count: u32) -> f32 {
  var minDistance = 1.0e6;
  var inside = false;
  var previous = u.pathVertices[count - 1u].xy;
  for (var i = 0u; i < 32u; i = i + 1u) {
    if (i >= count) {
      break;
    }
    let current = u.pathVertices[i].xy;
    minDistance = min(minDistance, sdSegment(p, previous, current));
    let dy = previous.y - current.y;
    let safeDy = select(select(0.00001, -0.00001, dy < 0.0), dy, abs(dy) > 0.00001);
    let crosses = ((current.y > p.y) != (previous.y > p.y)) &&
      (p.x < (previous.x - current.x) * (p.y - current.y) / safeDy + current.x);
    if (crosses) {
      inside = !inside;
    }
    previous = current;
  }
  return select(minDistance, -minDistance, inside);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let pixel = input.uv * u.outputSize;
  let halfSize = u.transformRect.zw * 0.5;
  let center = u.transformRect.xy + halfSize;
  let relative = pixel - center;
  let cosR = cos(-u.flags.x);
  let sinR = sin(-u.flags.x);
  let localPx = vec2f(relative.x * cosR - relative.y * sinR, relative.x * sinR + relative.y * cosR);
  var d = 1.0e6;
  if (u.shapeKind < 0.5) {
    d = sdRoundedBox(localPx, halfSize, u.shapeParams.x);
  } else if (u.shapeKind < 2.5) {
    d = sdEllipse(localPx, halfSize);
  } else if (u.shapeKind < 3.5) {
    let dir = u.shapeParams.y;
    var a = vec2f(0.0, -halfSize.y);
    var b = vec2f(halfSize.x, halfSize.y);
    var c = vec2f(-halfSize.x, halfSize.y);
    if (dir > 0.5 && dir < 1.5) {
      a = vec2f(0.0, halfSize.y); b = vec2f(-halfSize.x, -halfSize.y); c = vec2f(halfSize.x, -halfSize.y);
    } else if (dir > 1.5 && dir < 2.5) {
      a = vec2f(-halfSize.x, 0.0); b = vec2f(halfSize.x, -halfSize.y); c = vec2f(halfSize.x, halfSize.y);
    } else if (dir > 2.5) {
      a = vec2f(halfSize.x, 0.0); b = vec2f(-halfSize.x, halfSize.y); c = vec2f(-halfSize.x, -halfSize.y);
    }
    d = triangleSigned(localPx, a, b, c);
  } else if (u.shapeKind > 5.5 && u.shapeKind < 6.5) {
    let heartBase = min(halfSize.x, halfSize.y);
    let heartHalf = vec2f(heartBase, heartBase / 1.1);
    d = heartDistance(localPx / max(heartHalf, vec2f(0.001))) * heartBase;
  } else if (u.shapeKind > 6.5 && u.shapeKind < 7.5) {
    d = pathPolygonDistance(localPx, u32(u.shapeParams.z));
  } else {
    let normalized = localPx / max(halfSize, vec2f(0.001));
    d = polarShapeDistance(normalized, u.shapeParams.z, u.shapeParams.w, u.shapeKind > 4.5) * min(halfSize.x, halfSize.y);
  }

  let edgeSoftness = max(u.flags.w, 0.75);
  let fillAlpha = 1.0 - smoothstep(-edgeSoftness, edgeSoftness, d);
  let strokeWidth = max(u.shapeParams.y, 0.0);
  let strokeAlpha = select(0.0, 1.0 - smoothstep(strokeWidth - 0.75, strokeWidth + 0.75, abs(d)), strokeWidth > 0.0);
  let color = mix(u.fillColor, u.strokeColor, strokeAlpha);
  let alpha = max(fillAlpha, strokeAlpha) * color.a * u.opacity;
  return vec4f(color.rgb, alpha);
}
`

export class ShapeRenderPipeline {
  private readonly replacePipeline: GPURenderPipeline
  private readonly blendPipeline: GPURenderPipeline
  private readonly bindGroupLayout: GPUBindGroupLayout
  private readonly uniformBuffer: GPUBuffer
  private bindGroup: GPUBindGroup | null = null

  constructor(private readonly device: GPUDevice) {
    const shaderModule = device.createShaderModule({
      label: 'shape-render',
      code: SHAPE_RENDER_SHADER,
    })
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'shape-render-layout',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    this.replacePipeline = this.createRenderPipeline(shaderModule, false)
    this.blendPipeline = this.createRenderPipeline(shaderModule, true)
    this.uniformBuffer = device.createBuffer({
      size: SHAPE_UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  private createRenderPipeline(shaderModule: GPUShaderModule, blend: boolean): GPURenderPipeline {
    return this.device.createRenderPipeline({
      label: 'shape-render-pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: 'rgba8unorm',
            blend: blend
              ? {
                  color: {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add',
                  },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                }
              : undefined,
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  renderShapeToTexture(outputTexture: GPUTexture, params: GpuShapeRenderParams): boolean {
    if (
      outputTexture.width !== params.outputWidth ||
      outputTexture.height !== params.outputHeight
    ) {
      return false
    }
    const kind = shapeKind(params.shapeType)
    if (kind === null) return false
    const direction =
      params.direction === 'down'
        ? 1
        : params.direction === 'left'
          ? 2
          : params.direction === 'right'
            ? 3
            : 0
    const strokeColor = params.strokeColor ?? params.fillColor
    const pathVertices = params.pathVertices ?? []
    const uniformData = new Float32Array([
      params.outputWidth,
      params.outputHeight,
      kind,
      params.opacity ?? 1,
      params.transformRect.x,
      params.transformRect.y,
      params.transformRect.width,
      params.transformRect.height,
      ...params.fillColor,
      ...strokeColor,
      params.cornerRadius ?? 0,
      params.strokeWidth ?? 0,
      params.shapeType === 'path'
        ? pathVertices.length
        : (params.points ?? (params.shapeType === 'polygon' ? 6 : 5)),
      params.innerRadius ?? 0.5,
      params.rotationRad ?? 0,
      params.aspectRatioLocked === false ? 0 : 1,
      direction,
      params.maskFeatherPixels ?? 0,
      ...packPathVertices(pathVertices),
    ])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData)
    const bindGroup = this.ensureBindGroup()
    const commandEncoder = this.device.createCommandEncoder()
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputTexture.createView(),
          loadOp: params.clear === false ? 'load' : 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(params.blend ? this.blendPipeline : this.replacePipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(6)
    pass.end()
    this.device.queue.submit([commandEncoder.finish()])
    return true
  }

  destroy(): void {
    this.uniformBuffer.destroy()
  }

  private ensureBindGroup(): GPUBindGroup {
    if (this.bindGroup) return this.bindGroup
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    })
    return this.bindGroup
  }
}

function shapeKind(shapeType: ShapeItem['shapeType']): number | null {
  switch (shapeType) {
    case 'rectangle':
      return 0
    case 'circle':
      return 1
    case 'ellipse':
      return 2
    case 'triangle':
      return 3
    case 'polygon':
      return 4
    case 'star':
      return 5
    case 'heart':
      return 6
    case 'path':
      return 7
    default:
      return null
  }
}

function packPathVertices(vertices: Array<[number, number]>): number[] {
  const packed: number[] = []
  for (let i = 0; i < MAX_GPU_SHAPE_PATH_VERTICES; i++) {
    const vertex = vertices[i] ?? [0, 0]
    packed.push(vertex[0], vertex[1], 0, 0)
  }
  return packed
}
