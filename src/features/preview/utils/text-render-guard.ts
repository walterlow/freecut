import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineTrack } from '@/types/timeline';

function hasVisibleStyledAnimatedText(
  track: TimelineTrack,
  keyframesByItemId: Map<string, ItemKeyframes>,
): boolean {
  if (!track.visible) return false;

  for (const item of track.items) {
    if (item.type !== 'text') continue;

    const hasStyledText = !!item.textShadow || (item.stroke?.width ?? 0) > 0;
    if (!hasStyledText) continue;

    const itemKeyframes = keyframesByItemId.get(item.id);
    const hasKeyframeAnimation = !!itemKeyframes?.properties.some(
      (property) => property.keyframes.length > 0
    );
    const hasFadeAnimation = (item.fadeIn ?? 0) > 0 || (item.fadeOut ?? 0) > 0;

    if (hasKeyframeAnimation || hasFadeAnimation) {
      return true;
    }
  }

  return false;
}

export function shouldPreferPlayerForStyledTextScrub(
  tracks: TimelineTrack[],
  keyframes: ItemKeyframes[],
): boolean {
  if (tracks.length === 0) {
    return false;
  }

  const keyframesByItemId = new Map<string, ItemKeyframes>();
  for (const itemKeyframes of keyframes) {
    keyframesByItemId.set(itemKeyframes.itemId, itemKeyframes);
  }

  return tracks.some((track) => hasVisibleStyledAnimatedText(track, keyframesByItemId));
}
