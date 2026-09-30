import type { ShapeItem } from '@/types/timeline'
import { FULLSCREEN_QUAD_WGSL } from '@/infrastructure/gpu-shared/fullscreen-quad'

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
  gradientEndColor?: [number, number, number, number]
  gradientAngleRad?: number
  strokeColor?: [number, number, number, number]
  strokeWidth?: number
  cornerRadius?: number
  direction?: ShapeItem['direction']
  points?: number
  innerRadius?: number
  trimPathStart?: number
  trimPathEnd?: number
  trimPathOffset?: number
  taperStartWidth?: number
  taperEndWidth?: number
  taperStartLength?: number
  taperEndLength?: number
  aspectRatioLocked?: boolean
  pathVertices?: Array<[number, number, number?]>
  pathClosed?: boolean
  clear?: boolean
  blend?: boolean
  maskFeatherPixels?: number
}

export const MAX_GPU_SHAPE_PATH_VERTICES = 32
export const SHAPE_UNIFORM_HEADER_FLOAT_COUNT = 40
const SHAPE_UNIFORM_FLOAT_COUNT = SHAPE_UNIFORM_HEADER_FLOAT_COUNT + MAX_GPU_SHAPE_PATH_VERTICES * 4

const SHAPE_RENDER_SHADER = /* wgsl */ `
${FULLSCREEN_QUAD_WGSL}

struct ShapeUniforms {
  outputSize: vec2f,
  shapeKind: f32,
  opacity: f32,
  transformRect: vec4f,
  fillColor: vec4f,
  strokeColor: vec4f,
  shapeParams: vec4f,
  flags: vec4f,
  trimParams: vec4f,
  taperParams: vec4f,
  gradientEndColor: vec4f,
  gradientParams: vec4f,
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

fn pathDistanceAndProgress(p: vec2f, count: u32, closed: bool) -> vec2f {
  var minDistance = 1.0e6;
  var closestProgress = 0.0;
  var inside = false;
  let segmentCount = select(max(count, 1u) - 1u, count, closed);
  for (var i = 0u; i < 32u; i = i + 1u) {
    if (i >= segmentCount) {
      break;
    }
    let currentData = u.pathVertices[i];
    let nextIndex = select(i + 1u, 0u, i + 1u >= count);
    let nextData = u.pathVertices[nextIndex];
    let current = currentData.xy;
    let next = nextData.xy;
    let segment = next - current;
    let h = clamp(dot(p - current, segment) / max(dot(segment, segment), 0.001), 0.0, 1.0);
    let candidateDistance = length(p - (current + segment * h));
    if (candidateDistance < minDistance) {
      minDistance = candidateDistance;
      let nextProgress = select(nextData.z, 1.0, closed && nextIndex == 0u);
      closestProgress = mix(currentData.z, nextProgress, h);
    }
    let dy = next.y - current.y;
    let safeDy = select(select(0.00001, -0.00001, dy < 0.0), dy, abs(dy) > 0.00001);
    let crosses = ((next.y > p.y) != (current.y > p.y)) &&
      (p.x < (next.x - current.x) * (p.y - current.y) / safeDy + current.x);
    if (closed && crosses) {
      inside = !inside;
    }
  }
  return vec2f(select(minDistance, -minDistance, inside), closestProgress);
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
  var outlineProgress = fract((atan2(localPx.y, localPx.x) + 1.57079632679) / 6.28318530718 + 1.0);
  if (u.shapeKind < 0.5) {
    d = sdRoundedBox(localPx, halfSize, u.shapeParams.x);
  } else if (u.shapeKind < 2.5) {
    d = sdEllipse(localPx, halfSize);
  } else if (u.shapeKind < 3.5) {
    let dir = u.flags.z;
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
    let pathResult = pathDistanceAndProgress(localPx, u32(u.shapeParams.z), u.flags.y > 0.5);
    d = pathResult.x;
    outlineProgress = pathResult.y;
  } else {
    let normalized = localPx / max(halfSize, vec2f(0.001));
    d = polarShapeDistance(normalized, u.shapeParams.z, u.shapeParams.w, u.shapeKind > 4.5) * min(halfSize.x, halfSize.y);
  }

  let usesAnalyticOutline = u.shapeKind < 0.5 || (u.shapeKind > 3.5 && u.shapeKind < 6.5);
  if (usesAnalyticOutline && u.flags.y > 1.5) {
    outlineProgress = pathDistanceAndProgress(localPx, u32(u.flags.y), true).y;
  }

  let edgeSoftness = max(u.flags.w, 0.75);
  let fillAlpha = 1.0 - smoothstep(-edgeSoftness, edgeSoftness, d);
  var taperProgress = outlineProgress;
  var strokeVisible = true;
  if (u.trimParams.w > 0.5) {
    outlineProgress = fract(outlineProgress - u.trimParams.z + 1.0);
    let trimStart = u.trimParams.x;
    let trimEnd = u.trimParams.y;
    if (trimEnd >= trimStart) {
      strokeVisible = (outlineProgress >= trimStart) && (outlineProgress <= trimEnd);
    } else {
      strokeVisible = (outlineProgress >= trimStart) || (outlineProgress <= trimEnd);
    }
    let visibleLength = select(1.0 - trimStart + trimEnd, trimEnd - trimStart, trimEnd >= trimStart);
    taperProgress = clamp(fract(outlineProgress - trimStart + 1.0) / max(visibleLength, 0.001), 0.0, 1.0);
  }
  let startScale = select(
    1.0,
    mix(u.taperParams.x, 1.0, taperProgress / max(u.taperParams.z, 0.001)),
    u.taperParams.z > 0.0 && (taperProgress < u.taperParams.z),
  );
  let distanceFromEnd = 1.0 - taperProgress;
  let endScale = select(
    1.0,
    mix(u.taperParams.y, 1.0, distanceFromEnd / max(u.taperParams.w, 0.001)),
    u.taperParams.w > 0.0 && (distanceFromEnd < u.taperParams.w),
  );
  let strokeWidth = max(u.shapeParams.y * startScale * endScale, 0.0);
  var strokeAlpha = select(0.0, 1.0 - smoothstep(strokeWidth - 0.75, strokeWidth + 0.75, abs(d)), strokeWidth > 0.0 && strokeVisible);
  let gradientDirection = vec2f(cos(u.gradientParams.x), sin(u.gradientParams.x));
  let gradientExtent = 0.5 / max(max(abs(gradientDirection.x), abs(gradientDirection.y)), 0.000001);
  let gradientStart = vec2f(0.5) - gradientDirection * gradientExtent;
  let gradientEnd = vec2f(0.5) + gradientDirection * gradientExtent;
  let localUv = localPx / max(u.transformRect.zw, vec2f(0.001)) + vec2f(0.5);
  let gradientVector = gradientEnd - gradientStart;
  let gradientProgress = clamp(
    dot(localUv - gradientStart, gradientVector) / max(dot(gradientVector, gradientVector), 0.000001),
    0.0,
    1.0,
  );
  let gradientColor = mix(u.fillColor, u.gradientEndColor, gradientProgress);
  let paintedFill = select(u.fillColor, gradientColor, u.gradientParams.y > 0.5);
  let color = mix(paintedFill, u.strokeColor, strokeAlpha);
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
    const pathVertices =
      params.shapeType === 'path'
        ? (params.pathVertices ?? [])
        : makeAnalyticOutlineVertices(params)
    const trimPathStart = Math.max(0, Math.min(100, params.trimPathStart ?? 0))
    const trimPathEnd = Math.max(0, Math.min(100, params.trimPathEnd ?? 100))
    const trimEnabled = trimPathStart !== 0 || trimPathEnd !== 100
    const gradientEndColor = params.gradientEndColor ?? params.fillColor
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
      params.shapeType === 'path' ? (params.pathClosed === false ? 0 : 1) : pathVertices.length,
      direction,
      params.maskFeatherPixels ?? 0,
      trimPathStart / 100,
      trimPathEnd / 100,
      (params.trimPathOffset ?? 0) / 360,
      trimEnabled ? 1 : 0,
      Math.max(0, params.taperStartWidth ?? 100) / 100,
      Math.max(0, params.taperEndWidth ?? 100) / 100,
      Math.max(0, Math.min(100, params.taperStartLength ?? 0)) / 100,
      Math.max(0, Math.min(100, params.taperEndLength ?? 0)) / 100,
      ...gradientEndColor,
      params.gradientAngleRad ?? 0,
      params.gradientEndColor ? 1 : 0,
      0,
      0,
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

function packPathVertices(vertices: Array<[number, number, number?]>): number[] {
  const packed: number[] = []
  for (let i = 0; i < MAX_GPU_SHAPE_PATH_VERTICES; i++) {
    const vertex = vertices[i] ?? [0, 0]
    packed.push(vertex[0], vertex[1], vertex[2] ?? 0, 0)
  }
  return packed
}

type OutlinePoint = [number, number]

/**
 * Samples the canonical outline order used by exported analytic shapes. The
 * shader still renders these shapes analytically; these vertices only provide
 * distance-along-path progress for trim and taper.
 */
function makeAnalyticOutlineVertices(
  params: Pick<
    GpuShapeRenderParams,
    'shapeType' | 'transformRect' | 'cornerRadius' | 'points' | 'innerRadius'
  >,
): Array<[number, number, number]> {
  const halfWidth = params.transformRect.width / 2
  const halfHeight = params.transformRect.height / 2
  let points: OutlinePoint[] = []

  if (params.shapeType === 'rectangle') {
    points = sampleRectangleOutline(halfWidth, halfHeight, params.cornerRadius ?? 0)
  } else if (params.shapeType === 'polygon' || params.shapeType === 'star') {
    const pointCount = Math.max(
      3,
      Math.round(params.points ?? (params.shapeType === 'polygon' ? 6 : 5)),
    )
    const vertexCount = params.shapeType === 'star' ? pointCount * 2 : pointCount
    const innerRadius = Math.max(0.05, Math.min(0.95, params.innerRadius ?? 0.5))
    points = Array.from({ length: vertexCount }, (_, index) => {
      const angle = (index * Math.PI * 2) / vertexCount - Math.PI / 2
      const radius = params.shapeType === 'star' && index % 2 === 1 ? innerRadius : 1
      return [Math.cos(angle) * halfWidth * radius, Math.sin(angle) * halfHeight * radius]
    })
  } else if (params.shapeType === 'heart') {
    points = sampleHeartOutline(Math.min(halfWidth, halfHeight))
  }

  return addOutlineProgress(resampleClosedOutline(points, MAX_GPU_SHAPE_PATH_VERTICES))
}

function sampleRectangleOutline(
  halfWidth: number,
  halfHeight: number,
  radius: number,
): OutlinePoint[] {
  const r = Math.max(0, Math.min(radius, halfWidth, halfHeight))
  if (r === 0) {
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ]
  }

  const points: OutlinePoint[] = [[-halfWidth + r, -halfHeight]]
  const corners: Array<[number, number, number]> = [
    [halfWidth - r, -halfHeight + r, -Math.PI / 2],
    [halfWidth - r, halfHeight - r, 0],
    [-halfWidth + r, halfHeight - r, Math.PI / 2],
    [-halfWidth + r, -halfHeight + r, Math.PI],
  ]
  for (const [cx, cy, startAngle] of corners) {
    for (let step = 0; step <= 4; step++) {
      const angle = startAngle + (step / 4) * (Math.PI / 2)
      const point: OutlinePoint = [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
      const previous = points.at(-1)
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point)
    }
  }
  points.pop()
  return points
}

function sampleHeartOutline(base: number): OutlinePoint[] {
  const width = base * 2
  const height = width / 1.1
  const x = (value: number) => value - width / 2
  const y = (value: number) => value - height / 2
  const bottomControlPointX = (23 / 110) * width
  const bottomControlPointY = 0.69 * height
  const bottomLeftControlPointY = 0.6 * height
  const topLeftControlPoint = 0.13 * height
  const topBezierWidth = (29 / 110) * width
  const topRightControlPointX = (15 / 110) * width
  const innerControlPointX = (5 / 110) * width
  const innerControlPointY = 0.07 * height
  const depth = 0.17 * height
  const segments: Array<[OutlinePoint, OutlinePoint, OutlinePoint, OutlinePoint]> = [
    [
      [x(width / 2), y(height)],
      [x(width / 2 - bottomControlPointX), y(bottomControlPointY)],
      [x(0), y(bottomLeftControlPointY)],
      [x(0), y(height / 4)],
    ],
    [
      [x(0), y(height / 4)],
      [x(0), y(topLeftControlPoint)],
      [x(width / 4 - topBezierWidth / 2), y(0)],
      [x(width / 4), y(0)],
    ],
    [
      [x(width / 4), y(0)],
      [x(width / 4 + topBezierWidth / 2), y(0)],
      [x(width / 2 - innerControlPointX), y(innerControlPointY)],
      [x(width / 2), y(depth)],
    ],
    [
      [x(width / 2), y(depth)],
      [x(width / 2 + innerControlPointX), y(innerControlPointY)],
      [x(width / 2 + topRightControlPointX), y(0)],
      [x((width / 4) * 3), y(0)],
    ],
    [
      [x((width / 4) * 3), y(0)],
      [x((width / 4) * 3 + topBezierWidth / 2), y(0)],
      [x(width), y(topLeftControlPoint)],
      [x(width), y(height / 4)],
    ],
    [
      [x(width), y(height / 4)],
      [x(width), y(bottomLeftControlPointY)],
      [x(width / 2 + bottomControlPointX), y(bottomControlPointY)],
      [x(width / 2), y(height)],
    ],
  ]
  const points: OutlinePoint[] = [segments[0]![0]]
  for (const [start, control1, control2, end] of segments) {
    for (let step = 1; step <= 5; step++) {
      const t = step / 5
      const mt = 1 - t
      points.push([
        mt ** 3 * start[0] +
          3 * mt ** 2 * t * control1[0] +
          3 * mt * t ** 2 * control2[0] +
          t ** 3 * end[0],
        mt ** 3 * start[1] +
          3 * mt ** 2 * t * control1[1] +
          3 * mt * t ** 2 * control2[1] +
          t ** 3 * end[1],
      ])
    }
  }
  points.pop()
  return points
}

function resampleClosedOutline(points: OutlinePoint[], maximum: number): OutlinePoint[] {
  if (points.length <= maximum) return points
  const progressPoints = addOutlineProgress(points)
  return Array.from({ length: maximum }, (_, index) => {
    const target = index / maximum
    const nextIndex = progressPoints.findIndex((point) => point[2] > target)
    const next =
      nextIndex < 0
        ? ([progressPoints[0]![0], progressPoints[0]![1], 1] as const)
        : progressPoints[nextIndex]!
    const previous =
      nextIndex < 0 ? progressPoints.at(-1)! : progressPoints[Math.max(0, nextIndex - 1)]!
    const previousProgress = nextIndex < 0 ? previous[2] : nextIndex === 0 ? 0 : previous[2]
    const amount =
      (target - previousProgress) / Math.max(next[2] - previousProgress, Number.EPSILON)
    return [
      previous[0] + (next[0] - previous[0]) * amount,
      previous[1] + (next[1] - previous[1]) * amount,
    ]
  })
}

function addOutlineProgress(points: OutlinePoint[]): Array<[number, number, number]> {
  if (points.length < 2) return []
  const distances = points.map((point, index) => {
    if (index === 0) return 0
    const previous = points[index - 1]!
    return Math.hypot(point[0] - previous[0], point[1] - previous[1])
  })
  const last = points.at(-1)!
  const first = points[0]!
  const total =
    distances.reduce((sum, distance) => sum + distance, 0) +
    Math.hypot(first[0] - last[0], first[1] - last[1])
  let traversed = 0
  return points.map((point, index) => {
    traversed += distances[index]!
    return [point[0], point[1], total > 0 ? traversed / total : 0]
  })
}
