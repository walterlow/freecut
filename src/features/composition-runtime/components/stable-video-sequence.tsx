/**
 * Stable Video Sequence
 *
 * A wrapper around Composition's Sequence that uses a stable key based on
 * originId for video items. This prevents video remounting when clips are
 * split, as split clips share the same originId.
 */

import React, { useMemo } from 'react';
import { Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from '../hooks/use-player-compat';
import type { TimelineItem, VideoItem } from '@/types/timeline';
import type { AudioEqSettings } from '@/types/audio';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import {
  findActiveVideoItemIndex,
  groupStableVideoItems,
  type StableVideoGroup,
} from '../utils/video-scene';
import {
  appendResolvedAudioEqSources,
  areAudioEqStagesEqual,
  getAudioEqSettings,
} from '@/shared/utils/audio-eq';

/** Video item with additional properties added by MainComposition */
export type StableVideoSequenceItem = VideoItem & {
  zIndex: number;
  muted: boolean;
  trackAudioEq?: AudioEqSettings;
  trackOrder: number;
  trackVisible: boolean;
  _sequenceFrameOffset?: number;
  _poolClipId?: string;
};

interface StableVideoSequenceProps {
  /** All video items that might share the same origin */
  items: StableVideoSequenceItem[];
  /** Shared transition windows for current composition */
  transitionWindows?: ResolvedTransitionWindow<TimelineItem>[];
  /** Render function for the video content */
  renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
  /** Number of frames to premount */
  premountFor?: number;
}

function areGroupPropsEqual(
  prevProps: {
    group: StableVideoGroup<StableVideoSequenceItem>;
    renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
    transitionWindows?: ResolvedTransitionWindow<TimelineItem>[];
  },
  nextProps: {
    group: StableVideoGroup<StableVideoSequenceItem>;
    renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
    transitionWindows?: ResolvedTransitionWindow<TimelineItem>[];
  },
): boolean {
  if (
    prevProps.group === nextProps.group
    && prevProps.renderItem === nextProps.renderItem
    && prevProps.transitionWindows === nextProps.transitionWindows
  ) {
    return true;
  }

  if (prevProps.renderItem !== nextProps.renderItem) {
    return false;
  }

  if (prevProps.transitionWindows !== nextProps.transitionWindows) {
    return false;
  }

  if (
    prevProps.group.originKey !== nextProps.group.originKey
    || prevProps.group.minFrom !== nextProps.group.minFrom
    || prevProps.group.maxEnd !== nextProps.group.maxEnd
    || prevProps.group.items.length !== nextProps.group.items.length
  ) {
    return false;
  }

  for (let i = 0; i < prevProps.group.items.length; i++) {
    const prevItem = prevProps.group.items[i]!;
    const nextItem = nextProps.group.items[i]!;
    if (
      prevItem.id !== nextItem.id
      || prevItem.speed !== nextItem.speed
      || prevItem.sourceStart !== nextItem.sourceStart
      || prevItem.sourceEnd !== nextItem.sourceEnd
      || prevItem.from !== nextItem.from
      || prevItem.durationInFrames !== nextItem.durationInFrames
      || prevItem.trackVisible !== nextItem.trackVisible
      || prevItem.muted !== nextItem.muted
      || (prevItem.crop?.left ?? 0) !== (nextItem.crop?.left ?? 0)
      || (prevItem.crop?.right ?? 0) !== (nextItem.crop?.right ?? 0)
      || (prevItem.crop?.top ?? 0) !== (nextItem.crop?.top ?? 0)
      || (prevItem.crop?.bottom ?? 0) !== (nextItem.crop?.bottom ?? 0)
      || (prevItem.crop?.softness ?? 0) !== (nextItem.crop?.softness ?? 0)
      || prevItem.cornerPin !== nextItem.cornerPin
      || prevItem.blendMode !== nextItem.blendMode
      || prevItem.src !== nextItem.src
      || prevItem.audioSrc !== nextItem.audioSrc
      || (prevItem.audioPitchSemitones ?? 0) !== (nextItem.audioPitchSemitones ?? 0)
      || (prevItem.audioPitchCents ?? 0) !== (nextItem.audioPitchCents ?? 0)
      || !areAudioEqStagesEqual(
        appendResolvedAudioEqSources(undefined, prevItem.trackAudioEq, getAudioEqSettings(prevItem)),
        appendResolvedAudioEqSources(undefined, nextItem.trackAudioEq, getAudioEqSettings(nextItem)),
      )
    ) {
      return false;
    }
  }

  return true;
}

const GroupRenderer: React.FC<{
  group: StableVideoGroup<StableVideoSequenceItem>;
  transitionWindows?: ResolvedTransitionWindow<TimelineItem>[];
  renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
}> = React.memo(({ group, transitionWindows = [], renderItem }) => {
  const sequenceContext = useSequenceContext();
  const localFrame = sequenceContext?.localFrame ?? 0;
  const isPremounted = localFrame < 0;
  const globalFrame = localFrame + group.minFrom;

  const rawActiveItemIndex = isPremounted ? -1 : findActiveVideoItemIndex(group.items, globalFrame);

  // Keep the left split active across same-origin overlaps so the stable lane
  // identity does not thrash at the transition cut point.
  const activeItemIndex = useMemo(() => {
    if (rawActiveItemIndex < 0 || group.items.length <= 1) return rawActiveItemIndex;
    for (const tw of transitionWindows) {
      if (globalFrame >= tw.startFrame && globalFrame < tw.endFrame) {
        const leftIdx = group.items.findIndex((item) => item.id === tw.leftClip.id);
        const rightIdx = group.items.findIndex((item) => item.id === tw.rightClip.id);
        if (leftIdx >= 0 && rightIdx >= 0 && rawActiveItemIndex === rightIdx) {
          return leftIdx;
        }
      }
    }
    return rawActiveItemIndex;
  }, [globalFrame, group.items, rawActiveItemIndex, transitionWindows]);

  const activeItem = activeItemIndex >= 0 ? group.items[activeItemIndex] : null;

  const adjustedItem = useMemo(() => {
    if (!activeItem) return null;
    const itemOffset = activeItem.from - group.minFrom;
    return {
      ...activeItem,
      _sequenceFrameOffset: itemOffset,
      _poolClipId: `group-${group.originKey}`,
    };
  }, [activeItem, group.minFrom, group.originKey]);

  return useMemo(() => {
    if (!adjustedItem) return null;
    return renderItem(adjustedItem);
  }, [adjustedItem, renderItem]);
}, areGroupPropsEqual);

GroupRenderer.displayName = 'GroupRenderer';

export const StableVideoSequence: React.FC<StableVideoSequenceProps> = ({
  items,
  transitionWindows,
  renderItem,
  premountFor = 0,
}) => {
  const { fps } = useVideoConfig();
  const defaultPremount = premountFor || Math.round(fps * 2);
  const groups = useMemo(() => groupStableVideoItems(items), [items]);

  return (
    <>
      {groups.map((group) => (
        <Sequence
          key={group.originKey}
          from={group.minFrom}
          durationInFrames={group.maxEnd - group.minFrom}
          premountFor={defaultPremount}
        >
          <GroupRenderer group={group} transitionWindows={transitionWindows} renderItem={renderItem} />
        </Sequence>
      ))}
    </>
  );
};
