/**
 * Keyframe animation system types.
 * Supports animating transform properties over time with easing.
 */

/** Properties that can be animated via keyframes */
export type BuiltInAnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'anchorX'
  | 'anchorY'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius'
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'cropSoftness'
  | 'volume'
  | 'textStyleScale'
  | 'fontSize'
  | 'lineHeight'
  | 'textPadding'
  | 'backgroundRadius'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
  | 'textShadowBlur'
  | 'strokeWidth'
  | 'trimPathStart'
  | 'trimPathEnd'
  | 'trimPathOffset'
  | 'taperStartWidth'
  | 'taperEndWidth'
  | 'taperStartLength'
  | 'taperEndLength'

export type EffectAnimatableProperty = `effect:${string}:${string}:${string}`

export type PathVertexAnimatableComponent =
  | 'positionX'
  | 'positionY'
  | 'inX'
  | 'inY'
  | 'outX'
  | 'outY'

export type PathVertexAnimatableProperty = `pathVertex:${number}:${PathVertexAnimatableComponent}`

export type AnimatableProperty =
  | BuiltInAnimatableProperty
  | PathVertexAnimatableProperty
  | EffectAnimatableProperty

/** Current persisted animation-domain version. Missing means the legacy scalar-only model. */
export const ANIMATION_CORE_VERSION = 2 as const

/** Coupled transform channels that must share timing and spatial interpolation. */
export type VectorAnimatableProperty = 'position' | 'scale' | 'anchor'

const VECTOR_ANIMATABLE_PROPERTIES = new Set<VectorAnimatableProperty>([
  'position',
  'scale',
  'anchor',
])

export function isVectorAnimatableProperty(property: string): property is VectorAnimatableProperty {
  return VECTOR_ANIMATABLE_PROPERTIES.has(property as VectorAnimatableProperty)
}

export interface Vector2 {
  x: number
  y: number
}

/** Transform/visual properties animatable via gizmo (excludes non-spatial props like volume) */
export type TransformAnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'anchorX'
  | 'anchorY'
  | 'rotation'
  | 'opacity'
  | 'cornerRadius'

const TRANSFORM_ANIMATABLE_PROPERTIES = new Set<TransformAnimatableProperty>([
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
])

export function isTransformAnimatableProperty(
  property: AnimatableProperty | string,
): property is TransformAnimatableProperty {
  return TRANSFORM_ANIMATABLE_PROPERTIES.has(property as TransformAnimatableProperty)
}

export type ShapeAnimatableProperty =
  | 'trimPathStart'
  | 'trimPathEnd'
  | 'trimPathOffset'
  | 'taperStartWidth'
  | 'taperEndWidth'
  | 'taperStartLength'
  | 'taperEndLength'

const SHAPE_ANIMATABLE_PROPERTIES = new Set<ShapeAnimatableProperty>([
  'trimPathStart',
  'trimPathEnd',
  'trimPathOffset',
  'taperStartWidth',
  'taperEndWidth',
  'taperStartLength',
  'taperEndLength',
])

export function isShapeAnimatableProperty(
  property: AnimatableProperty | string,
): property is ShapeAnimatableProperty {
  return SHAPE_ANIMATABLE_PROPERTIES.has(property as ShapeAnimatableProperty)
}

/** Scalar properties whose post-keyframe values can participate in direct links. */
export type LinkableAnimatableProperty = TransformAnimatableProperty | ShapeAnimatableProperty

export function isLinkableAnimatableProperty(
  property: AnimatableProperty | string,
): property is LinkableAnimatableProperty {
  return isTransformAnimatableProperty(property) || isShapeAnimatableProperty(property)
}

/** Direct links are deliberately limited to equal-shaped numeric values. */
export type DirectLinkableProperty = LinkableAnimatableProperty | VectorAnimatableProperty

export function isDirectLinkableProperty(property: string): property is DirectLinkableProperty {
  return isLinkableAnimatableProperty(property) || isVectorAnimatableProperty(property)
}

export function areDirectLinkPropertiesCompatible(
  target: DirectLinkableProperty,
  source: DirectLinkableProperty,
): boolean {
  return isVectorAnimatableProperty(target) === isVectorAnimatableProperty(source)
}

const VECTOR_LINK_COMPONENTS: Record<
  VectorAnimatableProperty,
  readonly [TransformAnimatableProperty, TransformAnimatableProperty]
> = {
  position: ['x', 'y'],
  scale: ['width', 'height'],
  anchor: ['anchorX', 'anchorY'],
}

export function getVectorAnimatablePropertyComponents(
  property: VectorAnimatableProperty,
): readonly [TransformAnimatableProperty, TransformAnimatableProperty] {
  return VECTOR_LINK_COMPONENTS[property]
}

/** Scalar component and vector links are mutually exclusive on the same channels. */
export function doDirectLinkTargetsConflict(
  left: DirectLinkableProperty,
  right: DirectLinkableProperty,
): boolean {
  if (left === right) return true
  if (isVectorAnimatableProperty(left)) {
    return VECTOR_LINK_COMPONENTS[left].includes(right as TransformAnimatableProperty)
  }
  if (isVectorAnimatableProperty(right)) {
    return VECTOR_LINK_COMPONENTS[right].includes(left as TransformAnimatableProperty)
  }
  return false
}

export type CropAnimatableProperty =
  | 'cropLeft'
  | 'cropRight'
  | 'cropTop'
  | 'cropBottom'
  | 'cropSoftness'

/**
 * A deterministic, typed direct link that makes one scalar property follow
 * another scalar property in the same composition. Item IDs keep links stable when a
 * layer is renamed; composition-time evaluation is handled by the resolver.
 */
export interface DirectPropertyLink {
  type: 'link'
  targetProperty: DirectLinkableProperty
  sourceItemId: string
  sourceProperty: DirectLinkableProperty
  enabled: boolean
  /** Reserved for AE-style delayed followers; zero is a direct pick-whip link. */
  timeOffsetFrames: number
}

/** Deterministic expression source evaluated by FreeCut's sandboxed DSL. */
export interface PropertyExpression {
  type: 'expression'
  targetProperty: DirectLinkableProperty
  source: string
  enabled: boolean
}

/** Legacy projects may still contain direct links in the expressions collection. */
export type StoredPropertyExpression = PropertyExpression | DirectPropertyLink

export function getDirectPropertyLinks(
  itemKeyframes: Pick<ItemKeyframes, 'propertyLinks' | 'expressions'> | undefined,
): readonly DirectPropertyLink[] {
  if (!itemKeyframes) return []
  const legacyLinks = (itemKeyframes.expressions ?? []).filter(
    (entry): entry is DirectPropertyLink => entry.type === 'link',
  )
  return [...(itemKeyframes.propertyLinks ?? []), ...legacyLinks]
}

export function getPropertyExpressions(
  itemKeyframes: Pick<ItemKeyframes, 'expressions'> | undefined,
): readonly PropertyExpression[] {
  return (itemKeyframes?.expressions ?? []).filter(
    (entry): entry is PropertyExpression => entry.type === 'expression',
  )
}

/**
 * Basic easing functions for interpolation between keyframes.
 * `hold` is a step interpolation — the value stays at the keyframe's
 * value until the next keyframe is reached (no interpolation).
 */
export type BasicEasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold'

/** Advanced easing types that require configuration */
export type AdvancedEasingType = 'cubic-bezier' | 'spring'

/** All available easing types */
export type EasingType = BasicEasingType | AdvancedEasingType

/**
 * Cubic bezier control points for custom easing curves.
 * Values typically range 0-1 for x, can exceed 0-1 for y (overshoot).
 */
export interface BezierControlPoints {
  /** First control point X (0-1) */
  x1: number
  /** First control point Y (can exceed 0-1 for overshoot) */
  y1: number
  /** Second control point X (0-1) */
  x2: number
  /** Second control point Y (can exceed 0-1 for overshoot) */
  y2: number
}

/**
 * Spring physics parameters for physics-based easing.
 */
export interface SpringParameters {
  /** Spring stiffness (0-500, default: 170) */
  tension: number
  /** Damping coefficient (0-100, default: 26) */
  friction: number
  /** Object mass (0.1-10, default: 1) */
  mass: number
}

/** Identifies keyframes generated by one preset application. */
export interface AnimationKeyframeSource {
  applicationId: string
  kind: 'built-in-preset' | 'saved-preset'
  presetId: string
  presetName: string
}

/**
 * Configuration for advanced easing types.
 * Required when easing is 'cubic-bezier' or 'spring'.
 */
export interface EasingConfig {
  /** The easing type */
  type: EasingType
  /** Bezier control points (required when type is 'cubic-bezier') */
  bezier?: BezierControlPoints
  /** Spring parameters (required when type is 'spring') */
  spring?: SpringParameters
}

/**
 * Individual keyframe data point.
 * Represents a specific value at a specific frame.
 */
export interface Keyframe {
  /** Unique identifier for this keyframe */
  id: string
  /** Frame number relative to item start (0 = first frame of item) */
  frame: number
  /** The property value at this keyframe */
  value: number
  /** Easing function used when interpolating TO the next keyframe */
  easing: EasingType
  /** Advanced easing configuration (required for cubic-bezier and spring types) */
  easingConfig?: EasingConfig
  /** Optional provenance used by Applied Motion for targeted removal. */
  source?: AnimationKeyframeSource
}

/**
 * AE-style temporal handle. Speed uses property units per second; influence is
 * the percentage of the adjacent segment duration controlled by the handle.
 */
export interface TemporalEaseHandle {
  speed: number
  influence: number
}

export interface TemporalEase {
  /** Incoming velocity handle for the segment ending at this keyframe. */
  in?: TemporalEaseHandle
  /** Outgoing velocity handle for the segment starting at this keyframe. */
  out?: TemporalEaseHandle
}

/** Spatial tangents are offsets from the keyframe value, in property units. */
export interface SpatialBezierTangents {
  inTangent: Vector2
  outTangent: Vector2
  /** UI constraint: editing one tangent mirrors the other around the vertex. */
  continuous?: boolean
}

/** A coupled two-dimensional keyframe used by Animation Core v2. */
export interface VectorKeyframe {
  id: string
  /** Frame number relative to item start (0 = first frame of item). */
  frame: number
  value: Vector2
  /** Fallback timing curve when explicit temporal velocity handles are absent. */
  easing: EasingType
  easingConfig?: EasingConfig
  /** Incoming/outgoing velocity and influence used by value and speed graphs. */
  temporalEase?: TemporalEase
  /** Position-path Bezier handles. Ignored for Scale and Anchor. */
  spatial?: SpatialBezierTangents
  /** Optional provenance used by Applied Motion for targeted removal. */
  source?: AnimationKeyframeSource
}

/** Clone a vector keyframe without retaining mutable nested handle references. */
export function cloneVectorKeyframe(
  keyframe: VectorKeyframe,
  updates: Partial<Pick<VectorKeyframe, 'id' | 'frame'>> = {},
): VectorKeyframe {
  return {
    ...keyframe,
    ...updates,
    value: { ...keyframe.value },
    ...(keyframe.temporalEase && {
      temporalEase: {
        ...(keyframe.temporalEase.in && { in: { ...keyframe.temporalEase.in } }),
        ...(keyframe.temporalEase.out && { out: { ...keyframe.temporalEase.out } }),
      },
    }),
    ...(keyframe.spatial && {
      spatial: {
        ...keyframe.spatial,
        inTangent: { ...keyframe.spatial.inTangent },
        outTangent: { ...keyframe.spatial.outTangent },
      },
    }),
  }
}

export interface VectorPropertyKeyframes {
  property: VectorAnimatableProperty
  keyframes: VectorKeyframe[]
}

/**
 * Reference to a specific keyframe for selection/operations.
 */
export interface KeyframeRef {
  /** The timeline item ID */
  itemId: string
  /** The animated property */
  property: AnimatableProperty
  /** The keyframe ID */
  keyframeId: string
}

/**
 * Clipboard data for keyframe copy/paste operations.
 */
export interface KeyframeClipboard {
  /** Copied keyframes with normalized frame positions */
  keyframes: Array<{
    /** The property this keyframe animates */
    property: AnimatableProperty
    /** Frame position relative to first copied keyframe (0 = first) */
    frame: number
    /** The property value */
    value: number
    /** Easing type */
    easing: EasingType
    /** Advanced easing config */
    easingConfig?: EasingConfig
  }>
  /** Original item ID (for smart paste within same item) */
  sourceItemId?: string
  /** Absolute frame of the earliest copied keyframe */
  originFrame: number
  /** Original keyframe refs, used for cut/paste moves */
  sourceRefs: KeyframeRef[]
}

/**
 * Keyframes for a single property on a single item.
 * Keyframes are stored sorted by frame number.
 */
export interface PropertyKeyframes {
  /** The property being animated */
  property: AnimatableProperty
  /** Sorted array of keyframes for this property */
  keyframes: Keyframe[]
}

/**
 * All keyframes for a single timeline item.
 * Groups keyframes by property for efficient lookup.
 */
export interface ItemKeyframes {
  /** The timeline item ID these keyframes belong to */
  itemId: string
  /** Animation Core v2 marker. Missing records remain valid legacy animation data. */
  animationVersion?: typeof ANIMATION_CORE_VERSION
  /** Array of property keyframe groups */
  properties: PropertyKeyframes[]
  /** Coupled Position, Scale, and Anchor lanes introduced by Animation Core v2. */
  vectorProperties?: VectorPropertyKeyframes[]
  /** Vector properties intentionally authored as independent scalar component lanes. */
  separatedVectorProperties?: VectorAnimatableProperty[]
  /** Typed direct property links, keyed by their target property. */
  propertyLinks?: DirectPropertyLink[]
  /** Sandboxed expressions. Legacy imports may temporarily include type=link records. */
  expressions?: StoredPropertyExpression[]
}

/**
 * Display labels for animatable properties
 */
const BUILT_IN_PROPERTY_LABELS: Record<BuiltInAnimatableProperty, string> = {
  x: 'X Position',
  y: 'Y Position',
  width: 'Width',
  height: 'Height',
  anchorX: 'Anchor X',
  anchorY: 'Anchor Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  cornerRadius: 'Layer Radius',
  cropLeft: 'Crop Left',
  cropRight: 'Crop Right',
  cropTop: 'Crop Top',
  cropBottom: 'Crop Bottom',
  cropSoftness: 'Crop Softness',
  volume: 'Volume (dB)',
  textStyleScale: 'Style Preset Scale',
  fontSize: 'Font Size',
  lineHeight: 'Line Height',
  textPadding: 'Text Padding',
  backgroundRadius: 'Background Radius',
  textShadowOffsetX: 'Shadow X',
  textShadowOffsetY: 'Shadow Y',
  textShadowBlur: 'Shadow Blur',
  strokeWidth: 'Stroke Width',
  trimPathStart: 'Trim Paths Start',
  trimPathEnd: 'Trim Paths End',
  trimPathOffset: 'Trim Paths Offset',
  taperStartWidth: 'Taper Start Width',
  taperEndWidth: 'Taper End Width',
  taperStartLength: 'Taper Start Length',
  taperEndLength: 'Taper End Length',
}

const BUILT_IN_ANIMATABLE_PROPERTIES = new Set<BuiltInAnimatableProperty>(
  Object.keys(BUILT_IN_PROPERTY_LABELS) as BuiltInAnimatableProperty[],
)

export function isBuiltInAnimatableProperty(
  property: AnimatableProperty | string,
): property is BuiltInAnimatableProperty {
  return BUILT_IN_ANIMATABLE_PROPERTIES.has(property as BuiltInAnimatableProperty)
}

export function buildEffectAnimatableProperty(
  gpuEffectType: string,
  effectId: string,
  paramKey: string,
): EffectAnimatableProperty {
  return `effect:${gpuEffectType}:${effectId}:${paramKey}`
}

export function parseEffectAnimatableProperty(
  property: AnimatableProperty | string,
): { gpuEffectType: string; effectId: string; paramKey: string } | null {
  if (!property.startsWith('effect:')) {
    return null
  }

  const [, gpuEffectType = '', effectId = '', paramKey = ''] = property.split(':')
  if (!gpuEffectType || !effectId || !paramKey) {
    return null
  }

  return { gpuEffectType, effectId, paramKey }
}

export function isEffectAnimatableProperty(
  property: AnimatableProperty | string,
): property is EffectAnimatableProperty {
  return parseEffectAnimatableProperty(property) !== null
}

export function buildPathVertexAnimatableProperty(
  vertexIndex: number,
  component: PathVertexAnimatableComponent,
): PathVertexAnimatableProperty {
  return `pathVertex:${vertexIndex}:${component}`
}

export function parsePathVertexAnimatableProperty(
  property: AnimatableProperty | string,
): { vertexIndex: number; component: PathVertexAnimatableComponent } | null {
  const match = /^pathVertex:(\d+):(positionX|positionY|inX|inY|outX|outY)$/.exec(property)
  if (!match) return null
  return {
    vertexIndex: Number(match[1]),
    component: match[2] as PathVertexAnimatableComponent,
  }
}

export function isPathVertexAnimatableProperty(
  property: AnimatableProperty | string,
): property is PathVertexAnimatableProperty {
  return parsePathVertexAnimatableProperty(property) !== null
}

function getAnimatablePropertyLabel(property: AnimatableProperty): string {
  if (isBuiltInAnimatableProperty(property)) {
    return BUILT_IN_PROPERTY_LABELS[property]
  }

  const pathVertex = parsePathVertexAnimatableProperty(property)
  if (pathVertex) {
    const componentLabels: Record<PathVertexAnimatableComponent, string> = {
      positionX: 'X',
      positionY: 'Y',
      inX: 'In X',
      inY: 'In Y',
      outX: 'Out X',
      outY: 'Out Y',
    }
    return `Vertex ${pathVertex.vertexIndex + 1} ${componentLabels[pathVertex.component]}`
  }

  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed) {
    return property
  }

  return parsed.paramKey
}

export const PROPERTY_LABELS = new Proxy<Record<string, string>>(
  { ...BUILT_IN_PROPERTY_LABELS },
  {
    get(target, prop) {
      if (typeof prop !== 'string') {
        return undefined
      }

      return target[prop] ?? getAnimatablePropertyLabel(prop as AnimatableProperty)
    },
  },
) as Record<AnimatableProperty, string>

/**
 * Default spring parameters
 */
export const DEFAULT_SPRING_PARAMS: SpringParameters = {
  tension: 170,
  friction: 26,
  mass: 1,
}

/**
 * Default bezier control points (ease-in-out curve)
 */
export const DEFAULT_BEZIER_POINTS: BezierControlPoints = {
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
}
