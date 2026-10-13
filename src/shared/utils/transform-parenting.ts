import type { TimelineItem } from '@/types/timeline'
import {
  getDirectPropertyLinks,
  type DirectLinkableProperty,
  type ItemKeyframes,
} from '@/types/keyframe'
import type {
  ResolvedTransform,
  TransformParentBinding,
  TransformReference,
} from '@/types/transform'

interface AffineMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface TransformHierarchyContext {
  getItem: (itemId: string) => TimelineItem | undefined
  resolveLocal: (item: TimelineItem) => ResolvedTransform
}

interface TransformHierarchyState {
  cache: Map<string, ResolvedTransform>
  active: Set<string>
}

const MIN_DIMENSION = 0.000001

function multiply(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function invert(matrix: AffineMatrix): AffineMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < MIN_DIMENSION) return null
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  }
}

function toMatrix(transform: TransformReference): AffineMatrix {
  const radians = (transform.rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    a: cosine * transform.width,
    b: sine * transform.width,
    c: -sine * transform.height,
    d: cosine * transform.height,
    e: transform.x,
    f: transform.y,
  }
}

function applyMatrix(local: ResolvedTransform, matrix: AffineMatrix): ResolvedTransform {
  const width = Math.max(MIN_DIMENSION, Math.hypot(matrix.a, matrix.b))
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  const height = Math.max(MIN_DIMENSION, Math.abs(determinant) / width)
  const scaleX = width / Math.max(MIN_DIMENSION, local.width)
  const scaleY = height / Math.max(MIN_DIMENSION, local.height)
  return {
    ...local,
    x: matrix.e,
    y: matrix.f,
    width,
    height,
    anchorX: local.anchorX * scaleX,
    anchorY: local.anchorY * scaleY,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    cornerRadius: local.cornerRadius * Math.sqrt(scaleX * scaleY),
  }
}

function applyChildBasis(local: ResolvedTransform, binding: TransformParentBinding): AffineMatrix {
  const inverseLocalReference = invert(toMatrix(binding.childLocalReference))
  if (!inverseLocalReference) return toMatrix(local)
  return multiply(
    toMatrix(binding.childWorldReference),
    multiply(inverseLocalReference, toMatrix(local)),
  )
}

function toTransformReference(transform: ResolvedTransform): TransformReference {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    rotation: transform.rotation,
  }
}

export function createTransformParentBinding(params: {
  childLocal: ResolvedTransform
  childWorld: ResolvedTransform
  parentItemId?: string
  parentWorld?: ResolvedTransform
}): TransformParentBinding {
  return {
    ...(params.parentItemId && { parentItemId: params.parentItemId }),
    ...(params.parentWorld && {
      parentReference: toTransformReference(params.parentWorld),
    }),
    childLocalReference: toTransformReference(params.childLocal),
    childWorldReference: toTransformReference(params.childWorld),
  }
}

export function applyTransformParentBinding(
  local: ResolvedTransform,
  binding: TransformParentBinding,
  parentWorld?: ResolvedTransform,
): ResolvedTransform {
  let matrix = applyChildBasis(local, binding)
  if (parentWorld && binding.parentReference) {
    const inverseParentReference = invert(toMatrix(binding.parentReference))
    if (inverseParentReference) {
      const parentDelta = multiply(toMatrix(parentWorld), inverseParentReference)
      matrix = multiply(parentDelta, matrix)
    }
  }
  return applyMatrix(local, matrix)
}

/** Convert a canvas/world transform back into the child's editable local space. */
export function worldToLocalTransform(
  world: ResolvedTransform,
  binding: TransformParentBinding | undefined,
  parentWorld?: ResolvedTransform,
): ResolvedTransform {
  if (!binding) return world
  const inverseChildLocalReference = invert(toMatrix(binding.childLocalReference))
  if (!inverseChildLocalReference) return world
  let basis = multiply(toMatrix(binding.childWorldReference), inverseChildLocalReference)
  if (parentWorld && binding.parentReference) {
    const inverseParentReference = invert(toMatrix(binding.parentReference))
    if (inverseParentReference) {
      basis = multiply(multiply(toMatrix(parentWorld), inverseParentReference), basis)
    }
  }
  const inverseBasis = invert(basis)
  return inverseBasis ? applyMatrix(world, multiply(inverseBasis, toMatrix(world))) : world
}

export function resolveTransformHierarchy(
  item: TimelineItem,
  context: TransformHierarchyContext,
  state: TransformHierarchyState = { cache: new Map(), active: new Set() },
): ResolvedTransform {
  const cached = state.cache.get(item.id)
  if (cached) return cached

  const local = context.resolveLocal(item)
  const binding = item.transformParent
  if (!binding || state.active.has(item.id)) return local

  state.active.add(item.id)
  const parent = binding.parentItemId ? context.getItem(binding.parentItemId) : undefined
  const parentWorld = parent ? resolveTransformHierarchy(parent, context, state) : undefined
  const resolved = applyTransformParentBinding(local, binding, parentWorld)
  state.active.delete(item.id)
  state.cache.set(item.id, resolved)
  return resolved
}

export function wouldCreateTransformParentCycle(
  childItemId: string,
  parentItemId: string,
  getItem: (itemId: string) => TimelineItem | undefined,
  getKeyframes: (itemId: string) => ItemKeyframes | undefined = () => undefined,
): boolean {
  return wouldCreateItemDependencyCycle(childItemId, parentItemId, getItem, getKeyframes)
}

/**
 * Items depend on both their transform parent and the source layers of direct
 * property links. Reject a new dependency edge when either route would lead
 * back to the dependent item.
 */
export function wouldCreateItemDependencyCycle(
  dependentItemId: string,
  sourceItemId: string,
  getItem: (itemId: string) => TimelineItem | undefined,
  getKeyframes: (itemId: string) => ItemKeyframes | undefined,
): boolean {
  const visited = new Set<string>()
  const pending = [sourceItemId]

  while (pending.length > 0) {
    const currentId = pending.pop()!
    if (currentId === dependentItemId) return true
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const parentId = getItem(currentId)?.transformParent?.parentItemId
    if (parentId) pending.push(parentId)
    for (const link of getDirectPropertyLinks(getKeyframes(currentId))) {
      if (link.enabled) pending.push(link.sourceItemId)
    }
  }

  return false
}

const TRANSFORM_PARENT_INHERITED_PROPERTIES = new Set<DirectLinkableProperty>([
  'position',
  'scale',
  'x',
  'y',
  'width',
  'height',
  'rotation',
])

export function isTransformParentInheritedProperty(property: DirectLinkableProperty): boolean {
  return TRANSFORM_PARENT_INHERITED_PROPERTIES.has(property)
}

/** Whether `sourceItemId` already drives the item through its parent chain. */
export function hasTransformParentDependency(
  itemId: string,
  sourceItemId: string,
  getItem: (itemId: string) => TimelineItem | undefined,
): boolean {
  const visited = new Set<string>()
  let parentId = getItem(itemId)?.transformParent?.parentItemId

  while (parentId) {
    if (parentId === sourceItemId) return true
    if (visited.has(parentId)) return false
    visited.add(parentId)
    parentId = getItem(parentId)?.transformParent?.parentItemId
  }

  return false
}

/**
 * A child that already links Position/Scale/Rotation to its proposed parent
 * would receive the same transform once from the link and again from parenting.
 */
export function hasRedundantTransformParentLink(
  childItemId: string,
  parentItemId: string,
  getItem: (itemId: string) => TimelineItem | undefined,
  getKeyframes: (itemId: string) => ItemKeyframes | undefined,
): boolean {
  const parentIds = new Set<string>()
  const visited = new Set<string>()
  let currentId: string | undefined = parentItemId

  while (currentId) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    parentIds.add(currentId)
    currentId = getItem(currentId)?.transformParent?.parentItemId
  }

  return getDirectPropertyLinks(getKeyframes(childItemId)).some(
    (link) =>
      link.enabled &&
      isTransformParentInheritedProperty(link.targetProperty) &&
      parentIds.has(link.sourceItemId),
  )
}
