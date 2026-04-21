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
  /** Rotation anchor X in local item pixels from the left edge. Default: width / 2 */
  anchorX?: number;
  /** Rotation anchor Y in local item pixels from the top edge. Default: height / 2 */
  anchorY?: number;
  /** Rotation in degrees (clockwise). Default: 0 */
  rotation?: number;
  /** Flip content horizontally around its center. Default: false */
  flipHorizontal?: boolean;
  /** Flip content vertically around its center. Default: false */
  flipVertical?: boolean;
  /** Opacity from 0 (transparent) to 1 (opaque). Default: 1 */
  opacity?: number;
  /** Border radius in pixels. Default: 0 */
  cornerRadius?: number;
  /** UI state: aspect ratio lock for resize operations. Default: true */
  aspectRatioLocked?: boolean;
}

/**
 * Edge crop values stored as normalized source ratios.
 * Example: left=0.1 crops 10% of the source width from the left edge.
 * Softness is normalized against the smaller source dimension.
 * Negative values soften inward, positive values fade outward.
 */
export interface CropSettings {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  softness?: number;
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
  anchorX: number;
  anchorY: number;
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
