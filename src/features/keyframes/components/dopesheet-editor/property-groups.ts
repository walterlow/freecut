import {
  isEffectAnimatableProperty,
  isPathVertexAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
} from '@/types/keyframe'
import { getGpuEffect } from '@/infrastructure/gpu-effects'

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
    properties: ['x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'rotation'],
  },
  {
    id: 'composite',
    label: 'Composite',
    properties: ['opacity', 'cornerRadius'],
  },
  {
    id: 'textTypography',
    label: 'Text Typography',
    properties: ['textStyleScale', 'fontSize', 'lineHeight'],
  },
  {
    id: 'textBackground',
    label: 'Text Background',
    properties: ['textPadding', 'backgroundRadius'],
  },
  {
    id: 'textAppearance',
    label: 'Text Appearance',
    properties: ['textShadowOffsetX', 'textShadowOffsetY', 'textShadowBlur', 'strokeWidth'],
  },
  {
    id: 'textCounter',
    label: 'Text Counter',
    properties: ['counterValue'],
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
  {
    id: 'shape',
    label: 'Shape',
    properties: [
      'trimPathStart',
      'trimPathEnd',
      'trimPathOffset',
      'taperStartWidth',
      'taperEndWidth',
      'taperStartLength',
      'taperEndLength',
    ],
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
  const pathProperties = otherProperties.filter((property) =>
    isPathVertexAnimatableProperty(property),
  )
  if (pathProperties.length > 0) {
    groups.push({
      id: 'pathGeometry',
      label: 'Path Geometry',
      properties: pathProperties,
    })
  }

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
    (property) =>
      !isEffectAnimatableProperty(property) && !isPathVertexAnimatableProperty(property),
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

/**
 * Visual row hierarchy. The Parameters menu keeps one top-level Effects toggle,
 * while the editor itself splits those rows by effect instance so parameter
 * names can stay short and readable.
 */
export function getPropertyDisplayGroups(
  properties: readonly AnimatableProperty[],
): PropertyAccordionGroup[] {
  const filterGroups = getPropertyAccordionGroups(properties)
  const displayGroups: PropertyAccordionGroup[] = []

  for (const group of filterGroups) {
    if (group.id !== 'effects') {
      displayGroups.push(group)
      continue
    }

    const effectGroups = new Map<
      string,
      { gpuEffectType: string; properties: AnimatableProperty[] }
    >()
    for (const property of group.properties) {
      const parsed = parseEffectAnimatableProperty(property)
      if (!parsed) continue
      const existing = effectGroups.get(parsed.effectId)
      if (existing) {
        existing.properties.push(property)
      } else {
        effectGroups.set(parsed.effectId, {
          gpuEffectType: parsed.gpuEffectType,
          properties: [property],
        })
      }
    }

    const typeCounts = new Map<string, number>()
    for (const effectGroup of effectGroups.values()) {
      typeCounts.set(
        effectGroup.gpuEffectType,
        (typeCounts.get(effectGroup.gpuEffectType) ?? 0) + 1,
      )
    }
    const typeIndexes = new Map<string, number>()

    for (const [effectId, effectGroup] of effectGroups) {
      const typeIndex = (typeIndexes.get(effectGroup.gpuEffectType) ?? 0) + 1
      typeIndexes.set(effectGroup.gpuEffectType, typeIndex)
      const effectName = getGpuEffect(effectGroup.gpuEffectType)?.name ?? effectGroup.gpuEffectType
      displayGroups.push({
        id: `effect:${effectId}`,
        label:
          (typeCounts.get(effectGroup.gpuEffectType) ?? 0) > 1
            ? `${effectName} ${typeIndex}`
            : effectName,
        properties: effectGroup.properties,
      })
    }
  }

  return displayGroups
}
