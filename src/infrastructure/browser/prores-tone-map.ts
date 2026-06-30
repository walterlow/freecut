/**
 * HLG → SDR (Rec.709) tone-mapper for HDR ProRes frames.
 *
 * ProRes HDR (BT.2020/HLG) decodes with full fidelity, but the rest of the editor is
 * an 8-bit sRGB pipeline — drawing the frame to a 2D canvas applies a naive conversion
 * that looks washed/flat. This runs a WebGL2 pass over turbores' raw YUV planes:
 *   limited-range BT.2020 Y'CbCr → HLG signal → scene-linear (inverse HLG OETF)
 *   → filmic tone-map → BT.2020→Rec.709 gamut → sRGB OETF → 8-bit.
 *
 * Output is an 8-bit SDR `OffscreenCanvas` the existing pipeline consumes unchanged.
 * Runs in workers and on the main thread (OffscreenCanvas + WebGL2). Only HLG is
 * handled today (the validated path); other transfers return null so the caller falls
 * back to the native (untone-mapped) frame.
 */

import type { FilledFrame, PixelFormat } from 'turbores'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ProResToneMap')

// Scene-linear gain before the tone-map operator, and the operator's white point.
const EXPOSURE = 1.0
const HABLE_WHITE = 11.2

const VERTEX_SHADER = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENT_SHADER = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D yTex;
uniform highp usampler2D uTex;
uniform highp usampler2D vTex;
uniform float uBitScale;   // 2^(bitDepth-8): 4 for 10-bit, 16 for 12-bit
uniform float uExposure;
uniform vec2 uUvScale;     // visible / coded, to crop the coded padding
in vec2 uv;
out vec4 frag;

// HLG inverse OETF: signal E' (0..1) -> scene-linear E (0..1)
float hlgInv(float e) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  return (e <= 0.5) ? (e * e / 3.0) : (exp((e - c) / a) + b) / 12.0;
}
vec3 hable(vec3 x) {
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
float srgbOETF(float c) {
  return (c <= 0.0031308) ? (12.92 * c) : (1.055 * pow(c, 1.0 / 2.4) - 0.055);
}
void main() {
  vec2 suv = uv * uUvScale;
  ivec2 yc = ivec2(suv * vec2(textureSize(yTex, 0)));
  ivec2 cc = ivec2(suv * vec2(textureSize(uTex, 0)));
  float Y = float(texelFetch(yTex, yc, 0).r);
  float U = float(texelFetch(uTex, cc, 0).r);
  float V = float(texelFetch(vTex, cc, 0).r);
  // Limited-range normalization (8-bit refs scaled to bit depth).
  float yl = (Y - 16.0 * uBitScale) / (219.0 * uBitScale);
  float pb = (U - 128.0 * uBitScale) / (224.0 * uBitScale);
  float pr = (V - 128.0 * uBitScale) / (224.0 * uBitScale);
  // BT.2020 non-constant-luminance Y'CbCr -> R'G'B' (HLG-encoded).
  vec3 rgbHLG = clamp(vec3(
    yl + 1.4746 * pr,
    yl - 0.16455 * pb - 0.57135 * pr,
    yl + 1.8814 * pb
  ), 0.0, 1.0);
  vec3 lin = vec3(hlgInv(rgbHLG.r), hlgInv(rgbHLG.g), hlgInv(rgbHLG.b)) * uExposure;
  vec3 tm = hable(lin) / hable(vec3(${HABLE_WHITE}));
  // BT.2020 -> Rec.709 (linear gamut matrix, column-major).
  mat3 m = mat3(
     1.6605, -0.1246, -0.0182,
    -0.5876,  1.1329, -0.1006,
    -0.0728, -0.0083,  1.1187
  );
  vec3 r709 = clamp(m * tm, 0.0, 1.0);
  frag = vec4(srgbOETF(r709.r), srgbOETF(r709.g), srgbOETF(r709.b), 1.0);
}`

interface PlaneLayout {
  bitScale: number
  chromaXDiv: number
  chromaYDiv: number
}

/** Parses a turbores planar pixel format into chroma subsampling + bit depth. Returns
 * null for formats this tone-mapper doesn't handle (e.g. 8-bit, which HLG never uses). */
function parsePlaneLayout(format: PixelFormat): PlaneLayout | null {
  const bitDepth = format.includes('P12') ? 12 : format.includes('P10') ? 10 : 8
  if (bitDepth === 8) {
    return null
  }
  const chromaXDiv = format.startsWith('I444') ? 1 : 2
  const chromaYDiv = format.startsWith('I420') ? 2 : 1
  return { bitScale: 2 ** (bitDepth - 8), chromaXDiv, chromaYDiv }
}

/** Returns true if the decoded frame is HLG HDR and should be tone-mapped. */
export function frameNeedsToneMap(frame: FilledFrame): boolean {
  // 18 = ARIB STD-B67 (HLG) per ISO/IEC 23091-4.
  return frame.colorTransfer === 18 && parsePlaneLayout(frame.pixelFormat) !== null
}

let glContext: WebGL2RenderingContext | null = null
let glCanvas: OffscreenCanvas | null = null
let glProgram: WebGLProgram | null = null
let glUnsupported = false
const textures: Record<'y' | 'u' | 'v', WebGLTexture | null> = { y: null, u: null, v: null }

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Tone-map shader compile failed: ${info}`)
  }
  return shader
}

function ensureContext(): boolean {
  if (glContext && glProgram) {
    return true
  }
  if (glUnsupported) {
    return false
  }
  try {
    glCanvas = new OffscreenCanvas(2, 2)
    // preserveDrawingBuffer keeps the rendered frame readable when we snapshot it into
    // a VideoSample/VideoFrame (the default backbuffer may be cleared before the read).
    const gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true })
    if (!gl) {
      glUnsupported = true
      return false
    }
    const program = gl.createProgram()
    if (!program) {
      throw new Error('Failed to create program')
    }
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Tone-map program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.useProgram(program)

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    glContext = gl
    glProgram = program
    return true
  } catch (error) {
    log.warn('Tone-map GL init failed; falling back to native frame', { error })
    glUnsupported = true
    glContext = null
    glProgram = null
    return false
  }
}

function uploadPlane(
  gl: WebGL2RenderingContext,
  key: 'y' | 'u' | 'v',
  unit: number,
  data: Uint16Array,
  width: number,
  height: number,
): void {
  let tex = textures[key]
  if (!tex) {
    tex = gl.createTexture()
    textures[key] = tex
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  } else {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R16UI,
    width,
    height,
    0,
    gl.RED_INTEGER,
    gl.UNSIGNED_SHORT,
    data,
  )
}

/**
 * Tone-maps an HLG ProRes frame to an 8-bit SDR `OffscreenCanvas` (visible-sized).
 * Returns null if tone-mapping isn't applicable/available, so the caller falls back to
 * the native frame.
 */
export function toneMapProResFrame(frame: FilledFrame): OffscreenCanvas | null {
  const layout = parsePlaneLayout(frame.pixelFormat)
  if (!layout || !ensureContext()) {
    return null
  }
  const gl = glContext!

  const codedW = frame.codedWidth
  const codedH = frame.codedHeight
  const chromaW = Math.ceil(codedW / layout.chromaXDiv)
  const chromaH = Math.ceil(codedH / layout.chromaYDiv)

  const samples = new Uint16Array(
    frame.frameData.buffer,
    frame.frameData.byteOffset,
    frame.frameData.byteLength / 2,
  )
  const ySize = codedW * codedH
  const cSize = chromaW * chromaH
  if (samples.length < ySize + 2 * cSize) {
    return null
  }
  const yPlane = samples.subarray(0, ySize)
  const uPlane = samples.subarray(ySize, ySize + cSize)
  const vPlane = samples.subarray(ySize + cSize, ySize + 2 * cSize)

  const outW = frame.visibleWidth
  const outH = frame.visibleHeight
  if (glCanvas!.width !== outW || glCanvas!.height !== outH) {
    glCanvas!.width = outW
    glCanvas!.height = outH
  }

  uploadPlane(gl, 'y', 0, yPlane, codedW, codedH)
  uploadPlane(gl, 'u', 1, uPlane, chromaW, chromaH)
  uploadPlane(gl, 'v', 2, vPlane, chromaW, chromaH)

  const program = glProgram!
  gl.uniform1i(gl.getUniformLocation(program, 'yTex'), 0)
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 1)
  gl.uniform1i(gl.getUniformLocation(program, 'vTex'), 2)
  gl.uniform1f(gl.getUniformLocation(program, 'uBitScale'), layout.bitScale)
  gl.uniform1f(gl.getUniformLocation(program, 'uExposure'), EXPOSURE)
  gl.uniform2f(gl.getUniformLocation(program, 'uUvScale'), outW / codedW, outH / codedH)

  gl.viewport(0, 0, outW, outH)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  return glCanvas
}
