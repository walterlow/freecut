/**
 * Stable Video Sequence
 *
 * A wrapper around Composition's Sequence that uses a stable key based on
 * originId for video items. This prevents video remounting when clips
 * are split, as split clips share the same originId.
 *
 * The key insight: React's reconciliation won't remount a component if
 * its key stays the same. By keying video Sequences by originId instead
 * of item.id, split clips reuse the same Sequence/video element.
 */

import React, { useEffect, useMemo } from 'react';
import { Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoSourcePool } from '@/features/composition-runtime/deps/player';
import {
  DEFAULT_SPEED,
  getSafeTrimBefore,
} from '@/features/composition-runtime/deps/timeline';
import { useVideoConfig } from '../hooks/use-player-compat';
import { useTransitionParticipantSync } from '../hooks/use-transition-participant-sync';
import type { TimelineItem, VideoItem } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import { VideoContent } from './video-content';
import {
  findActiveVideoItemIndex,
  groupStableVideoItems,
  type StableVideoGroup,
} from '../utils/video-scene';
import {
  collectTransitionParticipantClipIds,
} from '../utils/transition-scene';
import { buildTransitionShadowWarmupRequests } from '../utils/transition-shadow-warmup';
import { createLogger } from '@/shared/logging/logger';
import { useMediaLibraryStore } from '@/features/composition-runtime/deps/stores';

const warmupLog = createLogger('StableVideoWarmup');
const SHADOW_MOUNT_LOOKAHEAD_FRAMES = 3;
const SHADOW_UNMOUNT_COOLDOWN_FRAMES = 3;
const TRANSITION_SYNC_COOLDOWN_FRAMES = 3;
const TRANSITION_WARMUP_LOOKAHEAD_SECONDS = 0.5;

/** Video item with additional properties added by MainComposition */
export type StableVideoSequenceItem = VideoItem & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
  _sequenceFrameOffset?: number;
  _poolClipId?: string;
  _sharedTransitionSync?: boolean;
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

/**
 * Renders the active item from a group based on current frame.
 *
 * CRITICAL for halftone/canvas effects:
 * 1. Memoizes adjustedItem so it only changes when crossing split boundaries
 * 2. Memoizes the RENDERED OUTPUT so renderItem isn't called every frame
 * This prevents re-renders of canvas-based effects like halftone on every frame.
 */
/**
 * Custom comparison for GroupRenderer to ensure re-render when item properties change.
 * Default React.memo shallow comparison only checks reference equality, which may miss
 * cases where group.items contains items with changed properties (like speed after rate stretch).
 */
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
  }
): boolean {
  // Quick reference check first
  if (
    prevProps.group === nextProps.group
    && prevProps.renderItem === nextProps.renderItem
    && prevProps.transitionWindows === nextProps.transitionWindows
  ) {
    return true;
  }

  // If renderItem changed, need to re-render
  if (prevProps.renderItem !== nextProps.renderItem) {
    return false;
  }

  if (prevProps.transitionWindows !== nextProps.transitionWindows) {
    return false;
  }

  // Check if group structure changed
  if (prevProps.group.originKey !== nextProps.group.originKey ||
      prevProps.group.minFrom !== nextProps.group.minFrom ||
      prevProps.group.maxEnd !== nextProps.group.maxEnd ||
      prevProps.group.items.length !== nextProps.group.items.length) {
    return false;
  }

  // Deep check: compare item properties that affect rendering
  for (let i = 0; i < prevProps.group.items.length; i++) {
    const prevItem = prevProps.group.items[i]!;
    const nextItem = nextProps.group.items[i]!;
    if (prevItem.id !== nextItem.id ||
        prevItem.speed !== nextItem.speed ||
        prevItem.sourceStart !== nextItem.sourceStart ||
        prevItem.sourceEnd !== nextItem.sourceEnd ||
        prevItem.from !== nextItem.from ||
        prevItem.durationInFrames !== nextItem.durationInFrames ||
        prevItem.trackVisible !== nextItem.trackVisible ||
        prevItem.muted !== nextItem.muted ||
        prevItem.cornerPin !== nextItem.cornerPin ||
        prevItem.blendMode !== nextItem.blendMode) {
      return false;
    }
  }

  return true;
}

const SHADOW_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  visibility: 'hidden',
  pointerEvents: 'none',
};

const HiddenShadowVideoBridge = React.memo(({ item }: { item: StableVideoSequenceItem }) => {
  const { fps } = useVideoConfig();
  const mediaSourceFps = useMediaLibraryStore((s) => (
    item.mediaId ? s.mediaItems.find((media) => media.id === item.mediaId)?.fps : undefined
  ));

  if (!item.src) {
    return null;
  }

  const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
  const sourceFps = item.sourceFps ?? mediaSourceFps ?? fps;
  const playbackRate = item.speed ?? DEFAULT_SPEED;
  const safeTrimBefore = getSafeTrimBefore(
    trimBefore,
    item.durationInFrames,
    playbackRate,
    item.sourceDuration || undefined,
    fps,
    sourceFps,
  );

  return (
    <div style={SHADOW_STYLE} data-shadow-bridge={item.id}>
      <VideoContent
        item={item}
        muted={true}
        safeTrimBefore={safeTrimBefore}
        playbackRate={playbackRate}
        sourceFps={sourceFps}
      />
    </div>
  );
});

HiddenShadowVideoBridge.displayName = 'HiddenShadowVideoBridge';

const GroupRenderer: React.FC<{
  group: StableVideoGroup<StableVideoSequenceItem>;
  transitionWindows?: ResolvedTransitionWindow<TimelineItem>[];
  renderItem: (item: StableVideoSequenceItem) => React.ReactNode;
}> = React.memo(({ group, transitionWindows = [], renderItem }) => {
  // Get local frame from Sequence context (0-based within this Sequence)
  // The Sequence component provides this via SequenceContext
  const sequenceContext = useSequenceContext();
  const localFrame = sequenceContext?.localFrame ?? 0;

  // CRITICAL: Don't render during premount phase (localFrame < 0)
  // Premount is for keeping React tree mounted, not for showing content.
  // Without this check, clips with gaps would show their start frame
  // before the playhead actually reaches them.
  const isPremounted = localFrame < 0;

  // Convert to global frame for comparison with item.from (which is global)
  const globalFrame = localFrame + group.minFrom;

  // Find the active item ID for current frame
  // During premount, don't find any active item - we shouldn't render.
  const activeItemIndex = isPremounted ? -1 : findActiveVideoItemIndex(group.items, globalFrame);
  const activeItem = activeItemIndex >= 0 ? group.items[activeItemIndex] : null;

  const { fps } = useVideoConfig();
  const pool = useVideoSourcePool();

  const transitionWarmupClipIds = useMemo(() => {
    if (isPremounted || activeItemIndex < 0 || group.items.length <= 1) return '';
    const transitionClipIds = collectTransitionParticipantClipIds({
      transitionWindows,
      frame: globalFrame,
      lookaheadFrames: Math.round(fps * TRANSITION_WARMUP_LOOKAHEAD_SECONDS),
    });
    return group.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index !== activeItemIndex && transitionClipIds.has(item.id))
      .map(({ index }) => index)
      .join(',');
  }, [activeItemIndex, fps, globalFrame, group.items, isPremounted, transitionWindows]);

  // Mount hidden transition shadows only a few frames before the overlap.
  // Pool lane warmup happens earlier; hidden DOM activation should stay late so
  // normal playback keeps using the simple single-clip path until near the cut.
  const overlapKey = useMemo(() => {
    if (isPremounted || activeItemIndex < 0 || group.items.length <= 1) return '';
    const transitionClipIds = collectTransitionParticipantClipIds({
      transitionWindows,
      frame: globalFrame,
      lookaheadFrames: SHADOW_MOUNT_LOOKAHEAD_FRAMES,
      lookbehindFrames: SHADOW_UNMOUNT_COOLDOWN_FRAMES,
    });
    return group.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index !== activeItemIndex && transitionClipIds.has(item.id))
      .map(({ index }) => index)
      .join(',');
  }, [isPremounted, activeItemIndex, group.items, transitionWindows, globalFrame, fps]);

  // Build adjusted shadow items — only recalculated when overlap composition changes.
  // String comparison is by value, so stable overlapKey prevents rebuilds every frame.
  const activeTransitionClipIds = useMemo(() => (
    collectTransitionParticipantClipIds({
      transitionWindows,
      frame: globalFrame,
      lookaheadFrames: 0,
      lookbehindFrames: TRANSITION_SYNC_COOLDOWN_FRAMES,
    })
  ), [globalFrame, transitionWindows]);

  const warmupShadows = useMemo(() => {
    if (!transitionWarmupClipIds) return [];
    const indices = transitionWarmupClipIds.split(',').map(Number);
    return indices.map(idx => group.items[idx]!);
  }, [group.items, transitionWarmupClipIds]);

  const adjustedShadows = useMemo(() => {
    if (!overlapKey) return [];
    const indices = overlapKey.split(',').map(Number);
    return indices.map(idx => {
      const item = group.items[idx]!;
      return {
        ...item,
        _sequenceFrameOffset: item.from - group.minFrom,
        // Separate pool ID so shadow gets its own video element (not shared with primary)
        _poolClipId: `shadow-${item.id}`,
        _sharedTransitionSync: activeTransitionClipIds.has(item.id),
      };
    });
    // overlapKey is a string — React compares by value, so this only re-runs
    // when the set of overlapping items actually changes (transition boundaries)
  }, [activeTransitionClipIds, group.items, group.minFrom, overlapKey]);

  // Memoize the adjusted item based on active item identity.
  // Only recalculates when crossing split boundaries or when item/group properties change.
  const adjustedItem = useMemo(() => {
    if (!activeItem) return null;

    // Keep source metadata absolute/stable.
    // Shared Sequence frame-origin differences are handled downstream via
    // _sequenceFrameOffset in video timing calculations.
    const itemOffset = activeItem.from - group.minFrom;

    return {
      ...activeItem,
      // Pass the frame offset so fades can be calculated correctly within shared Sequences
      // Without this, useCurrentFrame() returns the frame relative to the shared Sequence,
      // not relative to this specific item, causing fades to misbehave on split clips
      _sequenceFrameOffset: itemOffset,
      // Keep a stable pool identity across split boundaries so preview video
      // playback does not release/reacquire the element on item.id changes.
      _poolClipId: `group-${group.originKey}`,
      _sharedTransitionSync: activeTransitionClipIds.has(activeItem.id),
    };
  }, [activeItem, activeTransitionClipIds, group.minFrom]);

  // CRITICAL: Also memoize the RENDERED OUTPUT.
  // This prevents calling renderItem (which creates new React elements) every frame.
  // Without this, canvas-based effects like halftone would re-render on every frame.
  const renderedContent = useMemo(() => {
    if (!adjustedItem) return null;
    return renderItem(adjustedItem);
  }, [adjustedItem, renderItem]);

  // Memoize shadow content — only changes at transition boundaries
  const shadowContent = useMemo(() => {
    if (adjustedShadows.length === 0) return null;
    return adjustedShadows.map((shadow) => (
      <HiddenShadowVideoBridge key={shadow.id} item={shadow} />
    ));
  }, [adjustedShadows]);

  const transitionWarmupRequests = useMemo(
    () => buildTransitionShadowWarmupRequests(adjustedItem, warmupShadows),
    [adjustedItem, warmupShadows],
  );

  const syncShadows = useMemo(
    () => adjustedShadows.filter((item) => activeTransitionClipIds.has(item.id)),
    [activeTransitionClipIds, adjustedShadows],
  );

  const transitionSyncParticipants = useMemo(() => {
    if (!adjustedItem || syncShadows.length === 0 || !activeTransitionClipIds.has(adjustedItem.id)) {
      return [];
    }

    const mediaItems = useMediaLibraryStore.getState().mediaItems;
    const toParticipant = (
      item: StableVideoSequenceItem,
      role: 'leader' | 'follower',
    ) => {
      const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
      const mediaSourceFps = item.mediaId
        ? mediaItems.find((media) => media.id === item.mediaId)?.fps
        : undefined;
      const sourceFps = item.sourceFps ?? mediaSourceFps ?? fps;
      const playbackRate = item.speed ?? DEFAULT_SPEED;
      const safeTrimBefore = getSafeTrimBefore(
        trimBefore,
        item.durationInFrames,
        playbackRate,
        item.sourceDuration || undefined,
        fps,
        sourceFps,
      );

      return {
        poolClipId: item._poolClipId ?? item.id,
        safeTrimBefore,
        sourceFps,
        playbackRate,
        sequenceFrameOffset: item._sequenceFrameOffset ?? 0,
        role,
      };
    };

    return [
      toParticipant(adjustedItem, 'leader'),
      ...syncShadows.map((item) => toParticipant(item, 'follower')),
    ];
  }, [activeTransitionClipIds, adjustedItem, fps, syncShadows]);

  useTransitionParticipantSync(transitionSyncParticipants, group.minFrom, fps);

  useEffect(() => {
    if (transitionWarmupRequests.length === 0) {
      return;
    }

    let cancelled = false;

    for (const request of transitionWarmupRequests) {
      void pool.ensureReadyLanes(request.sourceUrl, request.minTotalLanes, {
        targetTimeSeconds: request.targetTimeSeconds,
        warmDecode: true,
      }).catch((error) => {
        if (cancelled) return;
        warmupLog.debug('Transition shadow warmup failed:', request.sourceUrl, error);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [pool, transitionWarmupRequests]);

  return (
    <>
      {renderedContent}
      {shadowContent}
    </>
  );
}, areGroupPropsEqual);

GroupRenderer.displayName = 'GroupRenderer';

/**
 * Renders video items with stable keys based on origin.
 *
 * Items sharing the same originId are grouped into a single Sequence
 * with a stable key. This prevents remounting when clips are split.
 */
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
          key={group.originKey} // Stable key - doesn't change on split!
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
