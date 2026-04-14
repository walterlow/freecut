/**
 * GPU texture manager for mask data.
 * Uploads CPU-rendered mask ImageData to GPU textures for use in
 * the compositor pipeline's fragment shader.
 */

export interface MaskInfo {
  hasMask: boolean;
  view: GPUTextureView;
}

export class MaskTextureManager {
  private device: GPUDevice;
  private textures = new Map<string, GPUTexture>();
  private views = new Map<string, GPUTextureView>();
  private fallbackTexture: GPUTexture;
  private fallbackView: GPUTextureView;

  constructor(device: GPUDevice) {
    this.device = device;

    // 1x1 white fallback (no mask = fully visible)
    this.fallbackTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.fallbackTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
    this.fallbackView = this.fallbackTexture.createView();
  }

  /**
   * Upload mask ImageData for an item. Pass null to clear.
   */
  updateMask(itemId: string, imageData: ImageData | null): void {
    if (!imageData) {
      this.removeMask(itemId);
      return;
    }

    const { width, height } = imageData;
    let tex = this.textures.get(itemId);

    // Recreate if size changed
    if (tex && (tex.width !== width || tex.height !== height)) {
      tex.destroy();
      tex = undefined;
    }

    if (!tex) {
      tex = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.textures.set(itemId, tex);
      this.views.set(itemId, tex.createView());
    }

    this.device.queue.writeTexture(
      { texture: tex },
      imageData.data,
      { bytesPerRow: width * 4 },
      { width, height },
    );
  }

  removeMask(itemId: string): void {
    const tex = this.textures.get(itemId);
    if (tex) {
      tex.destroy();
      this.textures.delete(itemId);
      this.views.delete(itemId);
    }
  }

  getMaskInfo(itemId: string): MaskInfo {
    const view = this.views.get(itemId);
    if (view) {
      return { hasMask: true, view };
    }
    return { hasMask: false, view: this.fallbackView };
  }

  getFallbackView(): GPUTextureView {
    return this.fallbackView;
  }

  destroy(): void {
    for (const tex of this.textures.values()) {
      tex.destroy();
    }
    this.textures.clear();
    this.views.clear();
    this.fallbackTexture.destroy();
  }
}
