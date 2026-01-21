/**
 * Canvas 2D Render Backend
 *
 * Fallback backend using Canvas 2D API. Limited capabilities but works everywhere.
 */

import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
  RenderPassDescriptor,
} from './types';

interface CanvasTexture {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  format: TextureFormat;
}

export class CanvasBackend implements RenderBackend {
  readonly name = 'canvas' as const;

  readonly capabilities: BackendCapabilities = {
    maxTextureSize: 4096,
    supportsFloat16: false,
    supportsComputeShaders: false,
    supportsExternalTextures: false,
    maxColorAttachments: 1,
  };

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private textures: Map<string, CanvasTexture> = new Map();
  private nextTextureId = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get Canvas 2D context');
    }

    this.ctx = ctx;
  }

  destroy(): void {
    this.textures.clear();
    this.canvas = null;
    this.ctx = null;
  }

  createTexture(width: number, height: number, format: TextureFormat): TextureHandle {
    const id = `canvas_tex_${this.nextTextureId++}`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create offscreen canvas context');
    }

    this.textures.set(id, { canvas, ctx, width, height, format });

    return { id, width, height, format };
  }

  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void {
    const texture = this.textures.get(handle.id);
    if (!texture) {
      throw new Error(`Texture not found: ${handle.id}`);
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      texture.width,
      texture.height
    );

    texture.ctx.putImageData(imageData, 0, 0);
  }

  importVideoFrame(frame: VideoFrame): TextureHandle {
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const handle = this.createTexture(width, height, 'rgba8unorm');

    const texture = this.textures.get(handle.id)!;
    texture.ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0);

    return handle;
  }

  importImageBitmap(bitmap: ImageBitmap): TextureHandle {
    const handle = this.createTexture(bitmap.width, bitmap.height, 'rgba8unorm');

    const texture = this.textures.get(handle.id)!;
    texture.ctx.drawImage(bitmap, 0, 0);

    return handle;
  }

  beginFrame(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  endFrame(): void {
    // Canvas 2D presents immediately, nothing to do
  }

  renderToScreen(texture: TextureHandle): void {
    if (!this.ctx || !this.canvas) return;

    const tex = this.textures.get(texture.id);
    if (!tex) return;

    this.ctx.drawImage(
      tex.canvas,
      0, 0, tex.width, tex.height,
      0, 0, this.canvas.width, this.canvas.height
    );
  }

  renderToTexture(pass: RenderPassDescriptor): void {
    if (!pass.output || pass.inputs.length === 0) return;

    const input = this.textures.get(pass.inputs[0].id);
    const output = this.textures.get(pass.output.id);

    if (!input || !output) return;

    output.ctx.drawImage(input.canvas, 0, 0);
  }

  async readPixels(texture: TextureHandle): Promise<Uint8Array> {
    const tex = this.textures.get(texture.id);
    if (!tex) {
      throw new Error(`Texture not found: ${texture.id}`);
    }

    const imageData = tex.ctx.getImageData(0, 0, tex.width, tex.height);
    return new Uint8Array(imageData.data.buffer);
  }

  releaseTexture(handle: TextureHandle): void {
    this.textures.delete(handle.id);
  }
}
