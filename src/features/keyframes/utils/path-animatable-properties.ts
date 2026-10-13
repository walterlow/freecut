import type {
  ItemKeyframes,
  PathVertexAnimatableComponent,
  PathVertexAnimatableProperty,
} from '@/types/keyframe'
import {
  buildPathVertexAnimatableProperty,
  isPathVertexAnimatableProperty,
  parsePathVertexAnimatableProperty,
} from '@/types/keyframe'
import type { MaskVertex } from '@/types/masks'

const PATH_VERTEX_COMPONENTS: readonly PathVertexAnimatableComponent[] = [
  'positionX',
  'positionY',
  'inX',
  'inY',
  'outX',
  'outY',
]

function getComponentValue(vertex: MaskVertex, component: PathVertexAnimatableComponent): number {
  switch (component) {
    case 'positionX':
      return vertex.position[0]
    case 'positionY':
      return vertex.position[1]
    case 'inX':
      return vertex.inHandle[0]
    case 'inY':
      return vertex.inHandle[1]
    case 'outX':
      return vertex.outHandle[0]
    case 'outY':
      return vertex.outHandle[1]
  }
}

function setComponentValue(
  vertex: MaskVertex,
  component: PathVertexAnimatableComponent,
  value: number,
): void {
  switch (component) {
    case 'positionX':
      vertex.position[0] = value
      return
    case 'positionY':
      vertex.position[1] = value
      return
    case 'inX':
      vertex.inHandle[0] = value
      return
    case 'inY':
      vertex.inHandle[1] = value
      return
    case 'outX':
      vertex.outHandle[0] = value
      return
    case 'outY':
      vertex.outHandle[1] = value
  }
}

export function getPathVertexAnimatableProperties(
  vertices: readonly MaskVertex[] | undefined,
): PathVertexAnimatableProperty[] {
  if (!vertices) return []
  return vertices.flatMap((_, vertexIndex) =>
    PATH_VERTEX_COMPONENTS.map((component) =>
      buildPathVertexAnimatableProperty(vertexIndex, component),
    ),
  )
}

export function getPathVertexPropertyValue(
  vertices: readonly MaskVertex[] | undefined,
  property: PathVertexAnimatableProperty,
): number {
  const parsed = parsePathVertexAnimatableProperty(property)
  const vertex = parsed ? vertices?.[parsed.vertexIndex] : undefined
  return parsed && vertex ? getComponentValue(vertex, parsed.component) : 0
}

export function setPathVertexPropertyValue(
  vertices: MaskVertex[],
  property: PathVertexAnimatableProperty,
  value: number,
): boolean {
  const parsed = parsePathVertexAnimatableProperty(property)
  const vertex = parsed ? vertices[parsed.vertexIndex] : undefined
  if (!parsed || !vertex) return false
  setComponentValue(vertex, parsed.component, value)
  return true
}

export function clonePathVertices(vertices: readonly MaskVertex[]): MaskVertex[] {
  return vertices.map((vertex) => ({
    ...vertex,
    position: [...vertex.position],
    inHandle: [...vertex.inHandle],
    outHandle: [...vertex.outHandle],
  }))
}

export function hasPathVertexKeyframes(itemKeyframes: ItemKeyframes | undefined): boolean {
  return (
    itemKeyframes?.properties.some(
      (entry) => isPathVertexAnimatableProperty(entry.property) && entry.keyframes.length > 0,
    ) ?? false
  )
}

export function getChangedPathVertexValues(
  previous: readonly MaskVertex[],
  next: readonly MaskVertex[],
  tolerance = 0.000001,
): Array<{ property: PathVertexAnimatableProperty; value: number }> {
  if (previous.length !== next.length) return []
  const changed: Array<{ property: PathVertexAnimatableProperty; value: number }> = []
  for (const property of getPathVertexAnimatableProperties(next)) {
    const previousValue = getPathVertexPropertyValue(previous, property)
    const nextValue = getPathVertexPropertyValue(next, property)
    if (Math.abs(previousValue - nextValue) > tolerance) {
      changed.push({ property, value: nextValue })
    }
  }
  return changed
}

export { isPathVertexAnimatableProperty }
export type { PathVertexAnimatableProperty }
