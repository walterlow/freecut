import type { CompositionSpace } from '../contexts/composition-space-context'

/**
 * Derives the runtime inputs ShapeContent lays a shape out with: the
 * composition-space render scale, the shape's own frame, and its on-canvas
 * size/scale. All of it is pure — the component owns every subscription and
 * passes the values in.
 */

/** The sequence fields a shape's relative frame is derived from. */
export interface ShapeSequenceContext {
  from: number
  parentFrom: number
  localFrame: number
}

export interface ShapeRenderScale {
  scaleX: number
  scaleY: number
  /** Uniform scale used for stroke width and corner radius. */
  scale: number
}

/** The composition-space scale, defaulted to 1 for a missing provider. */
export function resolveRenderScale(space: CompositionSpace | null | undefined): ShapeRenderScale {
  return {
    scaleX: space?.scaleX ?? 1,
    scaleY: space?.scaleY ?? 1,
    scale: space?.scale ?? 1,
  }
}

/** The item's frame relative to its sequence, for keyframe resolution. */
export function resolveShapeRelativeFrame(
  item: { from: number; _sequenceFrameOffset?: number },
  sequenceContext: ShapeSequenceContext | null | undefined,
): number {
  const sequenceFrameOffset =
    item._sequenceFrameOffset ??
    (sequenceContext ? item.from - (sequenceContext.from - sequenceContext.parentFrom) : 0)
  return (sequenceContext?.localFrame ?? 0) - sequenceFrameOffset
}

/** Width/height fields shared by the item transform and the item preview. */
export interface ShapeTransformSize {
  width?: number
  height?: number
  aspectRatioLocked?: boolean
}

/** A gizmo preview transform always carries a concrete size. */
export interface ShapeGizmoSize {
  width: number
  height: number
  aspectRatioLocked?: boolean
}

export interface ShapeLayoutInput {
  /** The item itself: its transform is the base size and aspect-lock source. */
  item: { id: string; transform?: ShapeTransformSize | undefined }
  /** Evaluated visual size from the item wrapper; wins over every preview. */
  visualTransform: { width: number; height: number } | null
  itemPreviewTransform: ShapeTransformSize | undefined
  /** Gizmo drag transform; only read while that gizmo is active. */
  previewTransform: ShapeGizmoSize | null
  /** True when the active gizmo (and so its preview transform) is this item's. */
  isGizmoPreviewActive: boolean
  renderScaleX: number
  renderScaleY: number
}

export interface ShapeSize {
  width: number
  height: number
}

/** Base size at render scale: evaluated visual size, then item, then default. */
function resolveBaseShapeSize(input: ShapeLayoutInput): ShapeSize {
  return {
    width:
      (input.visualTransform?.width ?? input.item.transform?.width ?? 200) * input.renderScaleX,
    height:
      (input.visualTransform?.height ?? input.item.transform?.height ?? 200) * input.renderScaleY,
  }
}

/** One axis of a preview size, kept at the same render scale as the base. */
function resolvePreviewedShapeSize(
  preview: ShapeTransformSize,
  base: ShapeSize,
  renderScaleX: number,
  renderScaleY: number,
): ShapeSize {
  return {
    width: (preview.width ?? base.width / renderScaleX) * renderScaleX,
    height: (preview.height ?? base.height / renderScaleY) * renderScaleY,
  }
}

/**
 * Raw on-canvas size: the item/visual transform scaled into render space, then
 * overridden by a live preview when no visual transform already resolved it.
 */
function resolveShapeSize(input: ShapeLayoutInput): ShapeSize {
  const base = resolveBaseShapeSize(input)
  if (input.visualTransform) return base

  if (input.itemPreviewTransform) {
    return resolvePreviewedShapeSize(
      input.itemPreviewTransform,
      base,
      input.renderScaleX,
      input.renderScaleY,
    )
  }

  if (input.isGizmoPreviewActive && input.previewTransform) {
    return {
      width: input.previewTransform.width * input.renderScaleX,
      height: input.previewTransform.height * input.renderScaleY,
    }
  }

  return base
}

/** Aspect-ratio lock: preview transforms win, then item transform, else locked. */
function resolveShapeAspectLocked(input: ShapeLayoutInput): boolean {
  if (input.itemPreviewTransform?.aspectRatioLocked !== undefined) {
    return input.itemPreviewTransform.aspectRatioLocked
  }

  if (input.isGizmoPreviewActive && input.previewTransform?.aspectRatioLocked !== undefined) {
    return input.previewTransform.aspectRatioLocked
  }

  return input.item.transform?.aspectRatioLocked ?? true
}

export interface ShapeScaleStyle {
  /** Side of the square the shape is drawn at before squish/squash. */
  baseSize: number
  scaleStyle: React.CSSProperties
}

/**
 * Squish/squash policy: shapes that cannot express non-proportional geometry
 * are drawn at their smaller side and stretched to fill the box. A locked
 * aspect — or an unlocked one whose ratios already match — stays unstyled.
 */
function resolveShapeScaleStyle(
  width: number,
  height: number,
  aspectLocked: boolean,
): ShapeScaleStyle {
  const baseSize = Math.min(width, height)
  const scaleX = aspectLocked ? 1 : width / baseSize
  const scaleY = aspectLocked ? 1 : height / baseSize
  if (scaleX === 1 && scaleY === 1) return { baseSize, scaleStyle: {} }

  return { baseSize, scaleStyle: { transform: `scale(${scaleX}, ${scaleY})` } }
}

export interface ShapeLayout extends ShapeSize, ShapeScaleStyle {}

/**
 * Resolves everything the shape geometry needs to be placed: the size it is
 * drawn at, the square side the non-proportional shapes use, and the CSS
 * scale transform that stretches them to the box.
 */
export function resolveShapeLayout(
  input: Omit<ShapeLayoutInput, 'isGizmoPreviewActive'> & {
    activeGizmo: { itemId: string } | null
  },
): ShapeLayout {
  const isGizmoPreviewActive =
    input.activeGizmo?.itemId === input.item.id && input.previewTransform !== null
  const layoutInput: ShapeLayoutInput = { ...input, isGizmoPreviewActive }
  const { width, height } = resolveShapeSize(layoutInput)
  const { baseSize, scaleStyle } = resolveShapeScaleStyle(
    width,
    height,
    resolveShapeAspectLocked(layoutInput),
  )
  return { width, height, baseSize, scaleStyle }
}
