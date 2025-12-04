/**
 * WebGL-based halftone shader for real-time video processing.
 * Uses GLSL shaders to render halftone effect on GPU.
 */

// Vertex shader - simple pass-through
const VERTEX_SHADER = `
precision mediump float;
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// Fragment shader - halftone effect
const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform float u_dotSize;
uniform float u_spacing;
uniform float u_angle;
uniform float u_intensity;
uniform vec3 u_dotColor;
uniform vec3 u_bgColor;

// Rotate a point around origin
vec2 rotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

// Calculate luminance from RGB
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = v_texCoord;

  // Get the pixel color from source texture
  vec4 texColor = texture2D(u_image, uv);
  float lum = luminance(texColor.rgb);

  // Convert UV to pixel coordinates
  vec2 pixelCoord = uv * u_resolution;

  // Rotate coordinates for angled grid
  float angleRad = u_angle * 3.14159265 / 180.0;
  vec2 rotatedCoord = rotate(pixelCoord - u_resolution * 0.5, angleRad) + u_resolution * 0.5;

  // Calculate grid cell position
  vec2 cellPos = mod(rotatedCoord, u_spacing);
  vec2 cellCenter = vec2(u_spacing * 0.5);

  // Distance from cell center
  float dist = distance(cellPos, cellCenter);

  // Dot radius based on luminance (darker = larger dots)
  float darkness = 1.0 - lum;
  float maxRadius = u_dotSize * 0.5 * u_intensity;
  float radius = darkness * maxRadius;

  // Determine if we're inside a dot (with anti-aliasing)
  float edge = 0.5;
  float dotMask = 1.0 - smoothstep(radius - edge, radius + edge, dist);

  // Mix between background and dot color
  vec3 color = mix(u_bgColor, u_dotColor, dotMask);

  gl_FragColor = vec4(color, 1.0);
}
`;

export interface HalftoneGLOptions {
  dotSize: number;
  spacing: number;
  angle: number;
  intensity: number;
  backgroundColor: string;
  dotColor: string;
}

/**
 * Parse hex color to RGB values (0-1 range)
 */
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1]!, 16) / 255,
      parseInt(result[2]!, 16) / 255,
      parseInt(result[3]!, 16) / 255,
    ];
  }
  return [0, 0, 0];
}

/**
 * Create and compile a WebGL shader
 */
function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Create WebGL program from shaders
 */
function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

/**
 * HalftoneRenderer class - manages WebGL context and rendering
 */
export class HalftoneRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  // Uniform locations
  private uniforms: {
    resolution: WebGLUniformLocation | null;
    dotSize: WebGLUniformLocation | null;
    spacing: WebGLUniformLocation | null;
    angle: WebGLUniformLocation | null;
    intensity: WebGLUniformLocation | null;
    dotColor: WebGLUniformLocation | null;
    bgColor: WebGLUniformLocation | null;
  } = {
    resolution: null,
    dotSize: null,
    spacing: null,
    angle: null,
    intensity: null,
    dotColor: null,
    bgColor: null,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });

    if (!this.gl) {
      console.error('[HalftoneRenderer] WebGL not supported');
      return;
    }

    this.initGL();
  }

  private initGL(): void {
    const gl = this.gl;
    if (!gl) return;

    // Create program
    this.program = createProgram(gl);
    if (!this.program) return;

    gl.useProgram(this.program);

    // Get attribute locations
    const positionLoc = gl.getAttribLocation(this.program, 'a_position');
    const texCoordLoc = gl.getAttribLocation(this.program, 'a_texCoord');

    // Get uniform locations
    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      dotSize: gl.getUniformLocation(this.program, 'u_dotSize'),
      spacing: gl.getUniformLocation(this.program, 'u_spacing'),
      angle: gl.getUniformLocation(this.program, 'u_angle'),
      intensity: gl.getUniformLocation(this.program, 'u_intensity'),
      dotColor: gl.getUniformLocation(this.program, 'u_dotColor'),
      bgColor: gl.getUniformLocation(this.program, 'u_bgColor'),
    };

    // Set up position buffer (full-screen quad)
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // Set up texture coordinate buffer
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0, 1,
        1, 1,
        0, 0,
        0, 0,
        1, 1,
        1, 0,
      ]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

    // Create texture
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /**
   * Render halftone effect from video or image source
   */
  render(
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    options: HalftoneGLOptions
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.texture) return;

    const width = gl.canvas.width;
    const height = gl.canvas.height;

    // Set viewport
    gl.viewport(0, 0, width, height);

    // Update texture with source
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // Set uniforms
    gl.uniform2f(this.uniforms.resolution, width, height);
    gl.uniform1f(this.uniforms.dotSize, options.dotSize);
    gl.uniform1f(this.uniforms.spacing, options.spacing);
    gl.uniform1f(this.uniforms.angle, options.angle);
    gl.uniform1f(this.uniforms.intensity, options.intensity);

    const dotColor = hexToRgb(options.dotColor);
    gl.uniform3f(this.uniforms.dotColor, dotColor[0], dotColor[1], dotColor[2]);

    const bgColor = hexToRgb(options.backgroundColor);
    gl.uniform3f(this.uniforms.bgColor, bgColor[0], bgColor[1], bgColor[2]);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Clean up WebGL resources
   */
  dispose(): void {
    const gl = this.gl;
    if (!gl) return;

    if (this.texture) gl.deleteTexture(this.texture);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
    if (this.program) gl.deleteProgram(this.program);

    this.gl = null;
    this.program = null;
    this.texture = null;
  }

  /**
   * Check if renderer is ready
   */
  isReady(): boolean {
    return this.gl !== null && this.program !== null;
  }
}
