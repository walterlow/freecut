import type { AnimatableProperty } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';

export const VISUAL_ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'cornerRadius',
];

export const AUDIO_ANIMATABLE_PROPERTIES: AnimatableProperty[] = ['volume'];

export function getAnimatablePropertiesForItem(item: TimelineItem): AnimatableProperty[] {
  switch (item.type) {
    case 'audio':
      return AUDIO_ANIMATABLE_PROPERTIES;
    case 'video':
      return [...VISUAL_ANIMATABLE_PROPERTIES, ...AUDIO_ANIMATABLE_PROPERTIES];
    default:
      return VISUAL_ANIMATABLE_PROPERTIES;
  }
}
