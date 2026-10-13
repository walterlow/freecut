import {
  getDirectPropertyLinks,
  type DirectPropertyLink,
  type ItemKeyframes,
} from '@/types/keyframe'

const POSITION_LINK_TARGETS = new Set<DirectPropertyLink['targetProperty']>(['position', 'x', 'y'])

/**
 * A linked Position (or either scalar axis) owns canvas translation. Letting the
 * target preview a local move creates a false edit that the link resolver later
 * replaces, so canvas move gestures must defer to the link source instead.
 */
export function getPositionLinkOwner(
  itemKeyframes: Pick<ItemKeyframes, 'propertyLinks' | 'expressions'> | undefined,
): DirectPropertyLink | null {
  return (
    getDirectPropertyLinks(itemKeyframes).find(
      (link) => link.enabled && POSITION_LINK_TARGETS.has(link.targetProperty),
    ) ?? null
  )
}
