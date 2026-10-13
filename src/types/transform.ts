/**
 * Transform properties for visual items on the canvas.
 * All properties are optional - undefined means "use default".
 * Defaults are computed based on canvas size and source dimensions.
 */
export interface TransformProperties {
  /** Horizontal offset from canvas center (pixels). Default: 0 (centered) */
  x?: number
  /** Vertical offset from canvas center (pixels). Default: 0 (centered) */
  y?: number
  /** Explicit width in pixels. Default: computed from fit-to-canvas */
  width?: number
  /** Explicit height in pixels. Default: computed from fit-to-canvas */
  height?: number
  /** Rotation anchor X in local item pixels from the left edge. Default: width / 2 */
  anchorX?: number
  /** Rotation anchor Y in local item pixels from the top edge. Default: height / 2 */
  anchorY?: number
  /** Rotation in degrees (clockwise). Default: 0 */
  rotation?: number
  /** Flip content horizontally around its center. Default: false */
  flipHorizontal?: boolean
  /** Flip content vertically around its center. Default: false */
  flipVertical?: boolean
  /** Opacity from 0 (transparent) to 1 (opaque). Default: 1 */
  opacity?: number
  /**
   * Border radius in pixels, applied by CLIPPING the item's rendered bounding
   * box (video/image content). Default: 0. For shape items use
   * `ShapeItem.cornerRadius` instead — that one rounds the path geometry
   * itself; clipping a shape's box here cuts through its stroke.
   */
  cornerRadius?: number
  /** UI state: aspect ratio lock for resize operations. Default: true */
  aspectRatioLocked?: boolean
}

/**
 * Edge crop values stored as normalized source ratios.
 * Example: left=0.1 crops 10% of the source width from the left edge.
 * Softness is normalized against the smaller source dimension.
 * Negative values soften inward, positive values fade outward.
 *
 * Default semantics (refit off): the FULL source is contain-fitted into
 * `transform.width/height` first, then crop cuts INSIDE that fitted rect and
 * the remainder STAYS IN PLACE — the container is not re-filled. (The
 * interactive crop gizmo depends on this: dragging a handle must not shift the
 * image.) To make a cropped window fill the container manually, size the
 * container to the full source and offset it: container = window / (1 - cut
 * ratios), position derived from which source region should be visible.
 *
 * `refit: true` (opt-in, programmatic builds): crop applies to the SOURCE and
 * the cropped region is contain-fitted into `transform.width/height` — crop
 * and transform become independent (Premiere/Resolve semantics).
 */
export interface CropSettings {
  left?: number
  right?: number
  top?: number
  bottom?: number
  softness?: number
  refit?: boolean
}

/**
 * Computed/resolved transform values for rendering.
 * All values are concrete numbers, no undefined.
 */
export interface ResolvedTransform {
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
  rotation: number
  opacity: number
  cornerRadius: number
}

/** Persisted transform snapshot used to keep parenting changes visually stable. */
export type TransformReference = Pick<
  ResolvedTransform,
  'x' | 'y' | 'width' | 'height' | 'rotation'
>

/**
 * Bind-space relationship for transform parenting.
 *
 * The child references let attach, detach, and reparent operations preserve the
 * current world pose without rewriting its animation curves. A missing
 * `parentItemId` is an intentional detached basis, not a broken relationship.
 */
export interface TransformParentBinding {
  parentItemId?: string
  parentReference?: TransformReference
  childLocalReference: TransformReference
  childWorldReference: TransformReference
}

/** User-facing behavior used when attaching, detaching, or reparenting layers. */
export type TransformParentingBehavior = 'preserve-world' | 'snap-to-parent' | 'restore-local'

/**
 * Source dimensions for media items (intrinsic size).
 * Used to compute default transforms.
 */
export interface SourceDimensions {
  width: number
  height: number
}

/**
 * Canvas settings for computing default transforms.
 */
export interface CanvasSettings {
  width: number
  height: number
  fps: number
}
