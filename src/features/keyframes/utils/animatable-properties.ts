import type { AnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { getAnimatableEffectPropertiesForItem } from './effect-animatable-properties'
import { TEXT_ANIMATABLE_PROPERTIES } from './animated-text-item'
import { getPathVertexAnimatableProperties } from './path-animatable-properties'

const VISUAL_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
]

const VIDEO_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
]

const AUDIO_ANIMATABLE_PROPERTIES: AnimatableProperty[] = ['volume']
const CONTROLLER_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
]

export function getAnimatablePropertiesForItem(item: TimelineItem): AnimatableProperty[] {
  const effectProperties = getAnimatableEffectPropertiesForItem(item)

  switch (item.type) {
    case 'audio':
      return [...AUDIO_ANIMATABLE_PROPERTIES, ...effectProperties]
    case 'video':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        ...VIDEO_ANIMATABLE_PROPERTIES,
        ...AUDIO_ANIMATABLE_PROPERTIES,
        ...effectProperties,
      ]
    case 'composition':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        ...VIDEO_ANIMATABLE_PROPERTIES,
        ...AUDIO_ANIMATABLE_PROPERTIES,
        ...effectProperties,
      ]
    case 'text':
      return [...VISUAL_ANIMATABLE_PROPERTIES, ...TEXT_ANIMATABLE_PROPERTIES, ...effectProperties]
    case 'shape':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        'trimPathStart',
        'trimPathEnd',
        'trimPathOffset',
        'taperStartWidth',
        'taperEndWidth',
        'taperStartLength',
        'taperEndLength',
        ...(item.shapeType === 'path' ? getPathVertexAnimatableProperties(item.pathVertices) : []),
        ...effectProperties,
      ]
    case 'controller':
      return CONTROLLER_ANIMATABLE_PROPERTIES
    default:
      return [...VISUAL_ANIMATABLE_PROPERTIES, ...effectProperties]
  }
}
