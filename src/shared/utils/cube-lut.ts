function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseTriple(parts: string[], key: string): [number, number, number] {
  if (parts.length < 4) {
    throw new Error(`${key} requires 3 numeric values`);
  }
  const x = Number.parseFloat(parts[1]!);
  const y = Number.parseFloat(parts[2]!);
  const z = Number.parseFloat(parts[3]!);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`${key} contains invalid numeric values`);
  }
  return [x, y, z];
}

function toNormalizedDomain(value: number, min: number, max: number): number {
  const width = max - min;
  if (Math.abs(width) < 1e-9) return 0;
  return clamp((value - min) / width, 0, 1);
}

export interface ParsedCubeLut {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  table: Float32Array;
}

export function parseCubeLut(cubeText: string): ParsedCubeLut {
  const lines = cubeText.split(/\r?\n/);
  let title: string | undefined;
  let size: number | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const rows: number[] = [];

  for (const rawLine of lines) {
    const noComment = rawLine.split('#')[0]?.trim() ?? '';
    if (!noComment) continue;

    const parts = noComment.split(/\s+/);
    const keyword = parts[0]?.toUpperCase();
    if (!keyword) continue;

    if (keyword === 'TITLE') {
      const value = noComment.slice(5).trim();
      title = value.replace(/^"(.*)"$/, '$1');
      continue;
    }

    if (keyword === 'LUT_3D_SIZE') {
      if (parts.length < 2) {
        throw new Error('LUT_3D_SIZE requires a value');
      }
      const parsedSize = Number.parseInt(parts[1]!, 10);
      if (!Number.isFinite(parsedSize) || parsedSize < 2 || parsedSize > 128) {
        throw new Error('LUT_3D_SIZE must be between 2 and 128');
      }
      size = parsedSize;
      continue;
    }

    if (keyword === 'DOMAIN_MIN') {
      domainMin = parseTriple(parts, 'DOMAIN_MIN');
      continue;
    }

    if (keyword === 'DOMAIN_MAX') {
      domainMax = parseTriple(parts, 'DOMAIN_MAX');
      continue;
    }

    if (keyword === 'LUT_1D_SIZE') {
      throw new Error('1D LUT files are not supported');
    }

    if (parts.length >= 3) {
      const r = Number.parseFloat(parts[0]!);
      const g = Number.parseFloat(parts[1]!);
      const b = Number.parseFloat(parts[2]!);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        throw new Error('Invalid LUT row values');
      }
      rows.push(r, g, b);
      continue;
    }
  }

  if (!size) {
    throw new Error('Missing LUT_3D_SIZE');
  }

  const expectedTriples = size * size * size;
  if (rows.length !== expectedTriples * 3) {
    throw new Error(`Expected ${expectedTriples} LUT rows, got ${Math.floor(rows.length / 3)}`);
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    table: Float32Array.from(rows),
  };
}

const cachedCubeLuts = new Map<string, ParsedCubeLut | null>();

export function getCachedCubeLut(cubeText: string): ParsedCubeLut | null {
  const cached = cachedCubeLuts.get(cubeText);
  if (cached !== undefined) return cached;

  try {
    const parsed = parseCubeLut(cubeText);
    cachedCubeLuts.set(cubeText, parsed);
    return parsed;
  } catch {
    cachedCubeLuts.set(cubeText, null);
    return null;
  }
}

function sampleTrilinear(lut: ParsedCubeLut, r: number, g: number, b: number): [number, number, number] {
  const { size, table, domainMin, domainMax } = lut;
  const rN = toNormalizedDomain(r, domainMin[0], domainMax[0]) * (size - 1);
  const gN = toNormalizedDomain(g, domainMin[1], domainMax[1]) * (size - 1);
  const bN = toNormalizedDomain(b, domainMin[2], domainMax[2]) * (size - 1);

  const r0 = Math.floor(rN);
  const g0 = Math.floor(gN);
  const b0 = Math.floor(bN);
  const r1 = Math.min(size - 1, r0 + 1);
  const g1 = Math.min(size - 1, g0 + 1);
  const b1 = Math.min(size - 1, b0 + 1);

  const tr = rN - r0;
  const tg = gN - g0;
  const tb = bN - b0;

  const idx = (ri: number, gi: number, bi: number) => ((bi * size + gi) * size + ri) * 3;

  const c000 = idx(r0, g0, b0);
  const c100 = idx(r1, g0, b0);
  const c010 = idx(r0, g1, b0);
  const c110 = idx(r1, g1, b0);
  const c001 = idx(r0, g0, b1);
  const c101 = idx(r1, g0, b1);
  const c011 = idx(r0, g1, b1);
  const c111 = idx(r1, g1, b1);

  const lerp = (a: number, c: number, t: number) => a + (c - a) * t;

  const outR0 = lerp(lerp(table[c000]!, table[c100]!, tr), lerp(table[c010]!, table[c110]!, tr), tg);
  const outR1 = lerp(lerp(table[c001]!, table[c101]!, tr), lerp(table[c011]!, table[c111]!, tr), tg);

  const outG0 = lerp(lerp(table[c000 + 1]!, table[c100 + 1]!, tr), lerp(table[c010 + 1]!, table[c110 + 1]!, tr), tg);
  const outG1 = lerp(lerp(table[c001 + 1]!, table[c101 + 1]!, tr), lerp(table[c011 + 1]!, table[c111 + 1]!, tr), tg);

  const outB0 = lerp(lerp(table[c000 + 2]!, table[c100 + 2]!, tr), lerp(table[c010 + 2]!, table[c110 + 2]!, tr), tg);
  const outB1 = lerp(lerp(table[c001 + 2]!, table[c101 + 2]!, tr), lerp(table[c011 + 2]!, table[c111 + 2]!, tr), tg);

  return [lerp(outR0, outR1, tb), lerp(outG0, outG1, tb), lerp(outB0, outB1, tb)];
}

export function applyCubeLutToImageData(
  rgba: Uint8ClampedArray,
  cubeText: string,
  intensity: number
): boolean {
  const lut = getCachedCubeLut(cubeText);
  if (!lut) return false;

  const blend = clamp(intensity, 0, 1);
  if (blend <= 0) return true;

  for (let i = 0; i < rgba.length; i += 4) {
    const inR = (rgba[i] ?? 0) / 255;
    const inG = (rgba[i + 1] ?? 0) / 255;
    const inB = (rgba[i + 2] ?? 0) / 255;

    const [lutR, lutG, lutB] = sampleTrilinear(lut, inR, inG, inB);

    const outR = inR + (lutR - inR) * blend;
    const outG = inG + (lutG - inG) * blend;
    const outB = inB + (lutB - inB) * blend;

    rgba[i] = Math.round(clamp(outR, 0, 1) * 255);
    rgba[i + 1] = Math.round(clamp(outG, 0, 1) * 255);
    rgba[i + 2] = Math.round(clamp(outB, 0, 1) * 255);
  }

  return true;
}

type Canvas2dContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createGpuCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  return null;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  gl.deleteShader(shader);
  return null;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  gl.deleteProgram(program);
  return null;
}

class CubeLutGpuProcessor {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private sourceTexture: WebGLTexture | null = null;

  private attribPosition = -1;
  private uniformSource: WebGLUniformLocation | null = null;
  private uniformLut: WebGLUniformLocation | null = null;
  private uniformLutSize: WebGLUniformLocation | null = null;
  private uniformDomainMin: WebGLUniformLocation | null = null;
  private uniformDomainMax: WebGLUniformLocation | null = null;
  private uniformIntensity: WebGLUniformLocation | null = null;

  private lutTextureCache = new Map<
    string,
    {
      texture: WebGLTexture;
      size: number;
      domainMin: [number, number, number];
      domainMax: [number, number, number];
    }
  >();

  private ensureReady(width: number, height: number): boolean {
    if (!this.canvas) {
      this.canvas = createGpuCanvas(width, height);
      if (!this.canvas) return false;
    }

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    if (!this.gl) {
      const context = this.canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null;
      if (!context) return false;
      this.gl = context;
    }

    if (this.program && this.positionBuffer && this.sourceTexture) {
      return true;
    }

    const gl = this.gl;
    const vertexSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = (aPosition + 1.0) * 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uSource;
      uniform sampler2D uLut;
      uniform float uLutSize;
      uniform vec3 uDomainMin;
      uniform vec3 uDomainMax;
      uniform float uIntensity;

      vec3 fetchLutColor(float r, float g, float b, float size) {
        float x = (r + 0.5) / size;
        float y = ((b * size + g) + 0.5) / (size * size);
        return texture2D(uLut, vec2(x, y)).rgb;
      }

      vec3 sampleCubeLut(vec3 inputColor) {
        vec3 domainWidth = max(uDomainMax - uDomainMin, vec3(0.000001));
        vec3 normalized = clamp((inputColor - uDomainMin) / domainWidth, 0.0, 1.0);

        float size = uLutSize;
        vec3 coord = normalized * (size - 1.0);
        vec3 index0 = floor(coord);
        vec3 index1 = min(index0 + 1.0, vec3(size - 1.0));
        vec3 frac = coord - index0;

        vec3 c000 = fetchLutColor(index0.x, index0.y, index0.z, size);
        vec3 c100 = fetchLutColor(index1.x, index0.y, index0.z, size);
        vec3 c010 = fetchLutColor(index0.x, index1.y, index0.z, size);
        vec3 c110 = fetchLutColor(index1.x, index1.y, index0.z, size);
        vec3 c001 = fetchLutColor(index0.x, index0.y, index1.z, size);
        vec3 c101 = fetchLutColor(index1.x, index0.y, index1.z, size);
        vec3 c011 = fetchLutColor(index0.x, index1.y, index1.z, size);
        vec3 c111 = fetchLutColor(index1.x, index1.y, index1.z, size);

        vec3 c00 = mix(c000, c100, frac.x);
        vec3 c10 = mix(c010, c110, frac.x);
        vec3 c01 = mix(c001, c101, frac.x);
        vec3 c11 = mix(c011, c111, frac.x);
        vec3 c0 = mix(c00, c10, frac.y);
        vec3 c1 = mix(c01, c11, frac.y);
        return mix(c0, c1, frac.z);
      }

      void main() {
        vec4 sourceColor = texture2D(uSource, vUv);
        vec3 lutColor = sampleCubeLut(sourceColor.rgb);
        float blend = clamp(uIntensity, 0.0, 1.0);
        vec3 outputColor = mix(sourceColor.rgb, lutColor, blend);
        gl_FragColor = vec4(outputColor, sourceColor.a);
      }
    `;

    const program = createProgram(gl, vertexSource, fragmentSource);
    if (!program) return false;

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
      gl.deleteProgram(program);
      return false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const sourceTexture = gl.createTexture();
    if (!sourceTexture) {
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.program = program;
    this.positionBuffer = positionBuffer;
    this.sourceTexture = sourceTexture;

    this.attribPosition = gl.getAttribLocation(program, 'aPosition');
    this.uniformSource = gl.getUniformLocation(program, 'uSource');
    this.uniformLut = gl.getUniformLocation(program, 'uLut');
    this.uniformLutSize = gl.getUniformLocation(program, 'uLutSize');
    this.uniformDomainMin = gl.getUniformLocation(program, 'uDomainMin');
    this.uniformDomainMax = gl.getUniformLocation(program, 'uDomainMax');
    this.uniformIntensity = gl.getUniformLocation(program, 'uIntensity');

    return this.attribPosition >= 0
      && this.uniformSource !== null
      && this.uniformLut !== null
      && this.uniformLutSize !== null
      && this.uniformDomainMin !== null
      && this.uniformDomainMax !== null
      && this.uniformIntensity !== null;
  }

  private ensureLutTexture(cubeText: string, parsed: ParsedCubeLut): {
    texture: WebGLTexture;
    size: number;
    domainMin: [number, number, number];
    domainMax: [number, number, number];
  } | null {
    const cached = this.lutTextureCache.get(cubeText);
    if (cached) return cached;

    const gl = this.gl;
    if (!gl) return null;

    const textureHeight = parsed.size * parsed.size;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (parsed.size > maxTextureSize || textureHeight > maxTextureSize) {
      return null;
    }

    const lutTexture = gl.createTexture();
    if (!lutTexture) return null;

    const lutBytes = new Uint8Array(parsed.table.length);
    for (let i = 0; i < parsed.table.length; i += 1) {
      lutBytes[i] = Math.round(clamp(parsed.table[i] ?? 0, 0, 1) * 255);
    }

    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    // LUT tables are uploaded from typed arrays; keep unpack flip disabled.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      parsed.size,
      textureHeight,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      lutBytes
    );

    const stored = {
      texture: lutTexture,
      size: parsed.size,
      domainMin: parsed.domainMin,
      domainMax: parsed.domainMax,
    };
    this.lutTextureCache.set(cubeText, stored);
    return stored;
  }

  apply(
    ctx: Canvas2dContext,
    width: number,
    height: number,
    cubeText: string,
    intensity: number
  ): boolean {
    if (!this.ensureReady(width, height)) return false;
    if (!this.canvas || !this.gl || !this.program || !this.positionBuffer || !this.sourceTexture) {
      return false;
    }

    const parsed = getCachedCubeLut(cubeText);
    if (!parsed) return false;

    const lut = this.ensureLutTexture(cubeText, parsed);
    if (!lut) return false;

    const sourceCanvas = ctx.canvas as unknown as CanvasImageSource | undefined;
    if (!sourceCanvas) return false;

    const gl = this.gl;

    try {
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.program);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.attribPosition);
      gl.vertexAttribPointer(this.attribPosition, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      // Canvas/video/image uploads need Y flip for WebGL texture coordinates.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lut.texture);

      gl.uniform1i(this.uniformSource, 0);
      gl.uniform1i(this.uniformLut, 1);
      gl.uniform1f(this.uniformLutSize, lut.size);
      gl.uniform3f(this.uniformDomainMin, lut.domainMin[0], lut.domainMin[1], lut.domainMin[2]);
      gl.uniform3f(this.uniformDomainMax, lut.domainMax[0], lut.domainMax[1], lut.domainMax[2]);
      gl.uniform1f(this.uniformIntensity, clamp(intensity, 0, 1));

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.canvas as unknown as CanvasImageSource, 0, 0, width, height);
      return true;
    } catch {
      return false;
    }
  }
}

let sharedGpuProcessor: CubeLutGpuProcessor | null = null;

function getSharedGpuProcessor(): CubeLutGpuProcessor {
  if (!sharedGpuProcessor) {
    sharedGpuProcessor = new CubeLutGpuProcessor();
  }
  return sharedGpuProcessor;
}

export function applyCubeLutToCanvasContext(
  ctx: Canvas2dContext,
  cubeText: string,
  intensity: number,
  width: number,
  height: number
): boolean {
  const blend = clamp(intensity, 0, 1);
  if (blend <= 0) return true;
  return getSharedGpuProcessor().apply(ctx, width, height, cubeText, blend);
}
