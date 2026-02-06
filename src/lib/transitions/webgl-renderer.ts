/**
 * WebGL Transition Renderer
 *
 * GPU-accelerated rendering for transitions that benefit from shader-based processing.
 * Follows gl-transitions compatible shader format (uniforms: from, to, progress, resolution).
 *
 * Every WebGL transition MUST have a Canvas 2D fallback in its renderer.
 * WebGL is an optional enhancement, never a requirement.
 */

/** Check if WebGL2 is available in the current environment */
let webglAvailable: boolean | null = null;

export function isWebGLAvailable(): boolean {
  if (webglAvailable !== null) return webglAvailable;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    webglAvailable = gl !== null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }
  } catch {
    webglAvailable = false;
  }

  return webglAvailable;
}

/**
 * Compiled shader program with uniform locations cached.
 */
interface CompiledShader {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  attributes: Record<string, number>;
}

/**
 * WebGL transition renderer that manages a GL context and compiles/runs shaders.
 */
export class TransitionWebGLRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private shaderCache = new Map<string, CompiledShader>();
  private quadBuffer: WebGLBuffer | null = null;
  private fromTexture: WebGLTexture | null = null;
  private toTexture: WebGLTexture | null = null;

  /**
   * Initialize the WebGL context.
   * @returns true if initialization succeeded, false otherwise
   */
  init(width: number, height: number): boolean {
    if (!isWebGLAvailable()) return false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    this.gl = this.canvas.getContext('webgl2') as WebGL2RenderingContext
      || this.canvas.getContext('webgl') as WebGLRenderingContext;

    if (!this.gl) return false;

    // Create fullscreen quad
    this.quadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
      ]),
      this.gl.STATIC_DRAW
    );

    // Create textures
    this.fromTexture = this.createTexture();
    this.toTexture = this.createTexture();

    return true;
  }

  /**
   * Destroy the WebGL context and free resources.
   */
  destroy(): void {
    if (!this.gl) return;

    // Delete cached shaders
    for (const compiled of this.shaderCache.values()) {
      this.gl.deleteProgram(compiled.program);
    }
    this.shaderCache.clear();

    // Delete buffers and textures
    if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
    if (this.fromTexture) this.gl.deleteTexture(this.fromTexture);
    if (this.toTexture) this.gl.deleteTexture(this.toTexture);

    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();

    this.gl = null;
    this.canvas = null;
  }

  /**
   * Compile a GLSL transition shader.
   * Shader must define: vec4 transition(vec2 uv) using uniforms from, to, progress.
   */
  compileShader(id: string, fragmentSource: string): boolean {
    if (!this.gl) return false;
    if (this.shaderCache.has(id)) return true;

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = (a_position + 1.0) / 2.0;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fullFragmentSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D from, to;
      uniform float progress;
      uniform vec2 resolution;

      vec4 getFromColor(vec2 uv) { return texture2D(from, uv); }
      vec4 getToColor(vec2 uv) { return texture2D(to, uv); }

      ${fragmentSource}

      void main() {
        gl_FragColor = transition(v_texCoord);
      }
    `;

    const gl = this.gl;

    // Compile vertex shader
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) return false;
    gl.shaderSource(vs, vertexSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      return false;
    }

    // Compile fragment shader
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs) {
      gl.deleteShader(vs);
      return false;
    }
    gl.shaderSource(fs, fullFragmentSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return false;
    }

    // Link program
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return false;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Shaders can be deleted after linking
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return false;
    }

    // Cache uniform and attribute locations
    const compiled: CompiledShader = {
      program,
      uniforms: {
        from: gl.getUniformLocation(program, 'from'),
        to: gl.getUniformLocation(program, 'to'),
        progress: gl.getUniformLocation(program, 'progress'),
        resolution: gl.getUniformLocation(program, 'resolution'),
      },
      attributes: {
        a_position: gl.getAttribLocation(program, 'a_position'),
      },
    };

    this.shaderCache.set(id, compiled);
    return true;
  }

  /**
   * Render a transition frame using a compiled shader.
   * @returns The output canvas, or null if rendering failed
   */
  render(
    shaderId: string,
    fromCanvas: HTMLCanvasElement | OffscreenCanvas,
    toCanvas: HTMLCanvasElement | OffscreenCanvas,
    progress: number
  ): HTMLCanvasElement | null {
    const gl = this.gl;
    const compiled = this.shaderCache.get(shaderId);
    if (!gl || !compiled || !this.canvas) return null;

    const { program, uniforms, attributes } = compiled;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);

    // Upload textures
    this.uploadTexture(this.fromTexture!, fromCanvas, 0);
    this.uploadTexture(this.toTexture!, toCanvas, 1);

    // Set uniforms
    gl.uniform1i(uniforms.from!, 0);
    gl.uniform1i(uniforms.to!, 1);
    gl.uniform1f(uniforms.progress!, progress);
    gl.uniform2f(uniforms.resolution!, this.canvas.width, this.canvas.height);

    // Draw quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(attributes.a_position!);
    gl.vertexAttribPointer(attributes.a_position!, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return this.canvas;
  }

  /**
   * Get the output canvas (for reading pixels or drawing to another context).
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  // --- Private helpers ---

  private createTexture(): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;

    const tex = gl.createTexture();
    if (!tex) return null;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return tex;
  }

  private uploadTexture(
    texture: WebGLTexture,
    source: HTMLCanvasElement | OffscreenCanvas,
    unit: number
  ): void {
    const gl = this.gl;
    if (!gl) return;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource
    );
  }
}

/** Singleton instance for shared use */
let sharedRenderer: TransitionWebGLRenderer | null = null;

/**
 * Get (or create) a shared WebGL renderer instance.
 * Returns null if WebGL is not available.
 */
export function getSharedWebGLRenderer(
  width: number,
  height: number
): TransitionWebGLRenderer | null {
  if (!isWebGLAvailable()) return null;

  if (!sharedRenderer) {
    sharedRenderer = new TransitionWebGLRenderer();
    if (!sharedRenderer.init(width, height)) {
      sharedRenderer = null;
      return null;
    }
  }

  return sharedRenderer;
}

/**
 * Destroy the shared renderer (call on cleanup/unmount).
 */
export function destroySharedWebGLRenderer(): void {
  if (sharedRenderer) {
    sharedRenderer.destroy();
    sharedRenderer = null;
  }
}
