import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';

const UNIT_SPEED_EPSILON = 0.001;

type IndexedTransitionVisuals = {
  trackOrderById: Map<string, number>;
  itemTrackOrderById: Map<string, number>;
  masks: Array<{ item: TimelineItem; trackOrder: number }>;
  adjustmentLayers: Array<{ item: TimelineItem; trackOrder: number }>;
};

function isPlainDomSafeVideoItem(item: TimelineItem): boolean {
  return (
    item.type === 'video'
    && Math.abs((item.speed ?? 1) - 1) <= UNIT_SPEED_EPSILON
    && item.effects?.some((effect) => effect.enabled) !== true
    && (item.blendMode === undefined || item.blendMode === 'normal')
  );
}

function overlapsTransitionWindow(
  item: TimelineItem,
  window: ResolvedTransitionWindow<TimelineItem>,
): boolean {
  return item.from < window.endFrame && (item.from + item.durationInFrames) > window.startFrame;
}

function indexTransitionVisuals(tracks: TimelineTrack[]): IndexedTransitionVisuals {
  const trackOrderById = new Map<string, number>();
  const itemTrackOrderById = new Map<string, number>();
  const masks: Array<{ item: TimelineItem; trackOrder: number }> = [];
  const adjustmentLayers: Array<{ item: TimelineItem; trackOrder: number }> = [];

  for (const track of tracks) {
    const trackOrder = track.order ?? 0;
    trackOrderById.set(track.id, trackOrder);

    for (const item of track.items as TimelineItem[]) {
      itemTrackOrderById.set(item.id, trackOrder);
    }

    if (!track.visible) {
      continue;
    }

    for (const item of track.items as TimelineItem[]) {
      if (item.type === 'shape' && item.isMask) {
        masks.push({ item, trackOrder });
        continue;
      }

      if (item.type === 'adjustment' && item.effects?.some((effect) => effect.enabled) === true) {
        adjustmentLayers.push({ item, trackOrder });
      }
    }
  }

  return {
    trackOrderById,
    itemTrackOrderById,
    masks,
    adjustmentLayers,
  };
}

function getParticipantTrackOrders(
  window: ResolvedTransitionWindow<TimelineItem>,
  visuals: IndexedTransitionVisuals,
): number[] {
  const orders = new Set<number>();
  const leftTrackOrder = visuals.itemTrackOrderById.get(window.leftClip.id);
  const rightTrackOrder = visuals.itemTrackOrderById.get(window.rightClip.id);

  if (leftTrackOrder !== undefined) {
    orders.add(leftTrackOrder);
  }
  if (rightTrackOrder !== undefined) {
    orders.add(rightTrackOrder);
  }

  if (orders.size === 0) {
    const transitionTrackOrder = visuals.trackOrderById.get(window.transition.trackId);
    if (transitionTrackOrder !== undefined) {
      orders.add(transitionTrackOrder);
    }
  }

  return [...orders];
}

function isDomSafeTransitionWindow(
  window: ResolvedTransitionWindow<TimelineItem>,
  visuals: IndexedTransitionVisuals,
): boolean {
  if (!isPlainDomSafeVideoItem(window.leftClip) || !isPlainDomSafeVideoItem(window.rightClip)) {
    return false;
  }

  const participantTrackOrders = getParticipantTrackOrders(window, visuals);
  if (participantTrackOrders.length === 0) {
    return false;
  }

  const hasAffectingMask = visuals.masks.some(({ item, trackOrder }) => (
    overlapsTransitionWindow(item, window)
    && participantTrackOrders.some((participantTrackOrder) => (
      doesMaskAffectTrack(trackOrder, participantTrackOrder)
    ))
  ));
  if (hasAffectingMask) {
    return false;
  }

  const hasAffectingAdjustmentLayer = visuals.adjustmentLayers.some(({ item, trackOrder }) => (
    overlapsTransitionWindow(item, window)
    && participantTrackOrders.some((participantTrackOrder) => participantTrackOrder > trackOrder)
  ));
  if (hasAffectingAdjustmentLayer) {
    return false;
  }

  return true;
}

export function resolvePlaybackTransitionComplexStartFrames(
  playbackTransitionWindows: ResolvedTransitionWindow<TimelineItem>[],
  tracks: TimelineTrack[],
): Set<number> {
  const complexStartFrames = new Set<number>();
  const visuals = indexTransitionVisuals(tracks);

  for (const window of playbackTransitionWindows) {
    if (!isDomSafeTransitionWindow(window, visuals)) {
      complexStartFrames.add(window.startFrame);
    }
  }

  return complexStartFrames;
}
