import type { ShapeType } from '@/types/timeline'

/** Shared by the shape panel's controls and its update handlers. */
export const MIN_ENABLED_STROKE_WIDTH = 1
export const DEFAULT_STROKE_COLOR = '#3b82f6'

// Shape type options
export const SHAPE_TYPE_OPTIONS: { value: ShapeType; labelKey: string }[] = [
  { value: 'rectangle', labelKey: 'editor.shapeSection.typeRectangle' },
  { value: 'circle', labelKey: 'editor.shapeSection.typeCircle' },
  { value: 'triangle', labelKey: 'editor.shapeSection.typeTriangle' },
  { value: 'ellipse', labelKey: 'editor.shapeSection.typeEllipse' },
  { value: 'star', labelKey: 'editor.shapeSection.typeStar' },
  { value: 'polygon', labelKey: 'editor.shapeSection.typePolygon' },
  { value: 'heart', labelKey: 'editor.shapeSection.typeHeart' },
]
