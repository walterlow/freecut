/**
 * Transform properties for visual items on the canvas.
 * All properties are optional - undefined means "use default".
 * Defaults are computed based on canvas size and source dimensions.
 */
export interface TransformProperties {
  /** Horizontal offset from canvas center (pixels). Default: 0 (centered) */
  x?: number;
  /** Vertical offset from canvas center (pixels). Default: 0 (centered) */
  y?: number;
  /** Explicit width in pixels. Default: computed from fit-to-canvas */
  width?: number;
  /** Explicit height in pixels. Default: computed from fit-to-canvas */
  height?: number;
  /** Rotation in degrees (clockwise). Default: 0 */
  rotation?: number;
  /** Opacity from 0 (transparent) to 1 (opaque). Default: 1 */
  opacity?: number;
  /** Border radius in pixels. Default: 0 */
  cornerRadius?: number;
  /** UI state: aspect ratio lock for resize operations. Default: true */
  aspectRatioLocked?: boolean;
}

/**
 * Computed/resolved transform values for rendering.
 * All values are concrete numbers, no undefined.
 */
export interface ResolvedTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  cornerRadius: number;
}

/**
 * Source dimensions for media items (intrinsic size).
 * Used to compute default transforms.
 */
export interface SourceDimensions {
  width: number;
  height: number;
}

/**
 * Canvas settings for computing default transforms.
 */
export interface CanvasSettings {
  width: number;
  height: number;
  fps: number;
}
