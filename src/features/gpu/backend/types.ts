/**
 * GPU Backend Types
 *
 * Defines the abstraction layer for WebGPU, WebGL2, and Canvas rendering backends.
 */

export type BackendName = 'webgpu' | 'webgl2' | 'canvas';

export type TextureFormat = 'rgba8unorm' | 'rgba16float' | 'rgba32float' | 'bgra8unorm';

export interface TextureHandle {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
}

export interface BackendCapabilities {
  readonly maxTextureSize: number;
  readonly supportsFloat16: boolean;
  readonly supportsComputeShaders: boolean;
  readonly supportsExternalTextures: boolean;
  readonly maxColorAttachments: number;
}

export interface RenderPassDescriptor {
  shader: string;
  inputs: TextureHandle[];
  output: TextureHandle | null;
  uniforms: Record<string, number | number[] | Float32Array>;
  viewport?: { width: number; height: number };
}

export interface RenderBackend {
  readonly name: BackendName;
  readonly capabilities: BackendCapabilities;

  init(canvas: HTMLCanvasElement): Promise<void>;
  destroy(): void;

  createTexture(width: number, height: number, format: TextureFormat): TextureHandle;
  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void;
  importVideoFrame(frame: VideoFrame): TextureHandle;
  importImageBitmap(bitmap: ImageBitmap): TextureHandle;

  beginFrame(): void;
  endFrame(): void;
  renderToScreen(texture: TextureHandle): void;
  renderToTexture(pass: RenderPassDescriptor): void;

  readPixels(texture: TextureHandle): Promise<Uint8Array>;
}

export interface BackendOptions {
  preferredBackend?: BackendName;
  debug?: boolean;
  powerPreference?: 'high-performance' | 'low-power';
}
