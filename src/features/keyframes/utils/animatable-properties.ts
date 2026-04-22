import type { AnimatableProperty } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';
import { getAnimatableEffectPropertiesForItem } from './effect-animatable-properties';
import { TEXT_ANIMATABLE_PROPERTIES } from './animated-text-item';

export const VISUAL_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'cornerRadius',
];

export const VIDEO_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'anchorX',
  'anchorY',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
];

export const AUDIO_ANIMATABLE_PROPERTIES: AnimatableProperty[] = ['volume'];

export function getAnimatablePropertiesForItem(item: TimelineItem): AnimatableProperty[] {
  const effectProperties = getAnimatableEffectPropertiesForItem(item);

  switch (item.type) {
    case 'audio':
      return [...AUDIO_ANIMATABLE_PROPERTIES, ...effectProperties];
    case 'video':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        ...VIDEO_ANIMATABLE_PROPERTIES,
        ...AUDIO_ANIMATABLE_PROPERTIES,
        ...effectProperties,
      ];
    case 'composition':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        'anchorX',
        'anchorY',
        ...AUDIO_ANIMATABLE_PROPERTIES,
        ...effectProperties,
      ];
    case 'text':
      return [
        ...VISUAL_ANIMATABLE_PROPERTIES,
        ...TEXT_ANIMATABLE_PROPERTIES,
        ...effectProperties,
      ];
    default:
      return [...VISUAL_ANIMATABLE_PROPERTIES, ...effectProperties];
  }
}
