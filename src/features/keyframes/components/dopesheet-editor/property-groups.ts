import { isEffectAnimatableProperty, type AnimatableProperty } from '@/types/keyframe'

export interface PropertyAccordionGroup {
  id: string
  label: string
  properties: AnimatableProperty[]
}

const PROPERTY_GROUP_DEFINITIONS: Array<{
  id: string
  label: string
  properties: AnimatableProperty[]
}> = [
  {
    id: 'transform',
    label: 'Transform',
    properties: [
      'x',
      'y',
      'width',
      'height',
      'anchorX',
      'anchorY',
      'rotation',
      'opacity',
      'cornerRadius',
    ],
  },
  {
    id: 'crop',
    label: 'Crop',
    properties: ['cropLeft', 'cropRight', 'cropTop', 'cropBottom', 'cropSoftness'],
  },
  {
    id: 'audio',
    label: 'Audio',
    properties: ['volume'],
  },
]

export function getPropertyAccordionGroups(
  properties: readonly AnimatableProperty[],
): PropertyAccordionGroup[] {
  const remaining = new Set(properties)
  const groups: PropertyAccordionGroup[] = []

  for (const definition of PROPERTY_GROUP_DEFINITIONS) {
    const groupedProperties = definition.properties.filter((property) => remaining.has(property))
    if (groupedProperties.length === 0) continue

    for (const property of groupedProperties) {
      remaining.delete(property)
    }

    groups.push({
      id: definition.id,
      label: definition.label,
      properties: groupedProperties,
    })
  }

  const otherProperties = properties.filter((property) => remaining.has(property))
  const effectProperties = otherProperties.filter((property) =>
    isEffectAnimatableProperty(property),
  )
  if (effectProperties.length > 0) {
    groups.push({
      id: 'effects',
      label: 'Effects',
      properties: effectProperties,
    })
  }

  const ungroupedProperties = otherProperties.filter(
    (property) => !isEffectAnimatableProperty(property),
  )
  if (ungroupedProperties.length > 0) {
    groups.push({
      id: 'other',
      label: 'Other',
      properties: ungroupedProperties,
    })
  }

  return groups
}
