import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useSequenceContext } from '@/features/player/composition';
import type { CompositionItem as CompositionItemType, TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store';
import { blobUrlManager, useBlobUrlVersion } from '@/lib/blob-url-manager';
import { VideoConfigProvider } from '@/features/player/VideoConfigProvider';
import { useVideoConfig } from '../hooks/use-player-compat';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { resolveTransform, getSourceDimensions } from '../utils/transform-resolver';
import { resolveAnimatedTransform, hasKeyframeAnimation } from '@/features/keyframes/utils/animated-transform-resolver';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { Item } from './item';

interface CompositionContentProps {
  item: CompositionItemType;
  parentMuted?: boolean;
  renderDepth?: number;
}

/**
 * Resolve media URLs on sub-comp items using the centralized blob URL manager.
 * The parent preview has already acquired blob URLs for all mediaIds —
 * we just need to look them up and set `src`.
 */
function resolveSubCompItem(subItem: TimelineItem): TimelineItem {
  if (
    subItem.mediaId &&
    (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'image')
  ) {
    const src = blobUrlManager.get(subItem.mediaId) ?? '';
    if (src !== subItem.src) {
      return { ...subItem, src } as TimelineItem;
    }
  }
  return subItem;
}

/**
 * Renders the contents of a sub-composition inline within the main preview.
 *
 * Each sub-composition item is rendered via a Sequence at its local `from`,
 * offset so that frame 0 of the sub-comp maps to the CompositionItem's
 * `from` on the parent timeline.
 *
 * The sub-comp is rendered at its own native resolution inside a VideoConfigProvider,
 * then CSS-scaled to fit the parent container dimensions. This ensures sub-items
 * use the correct coordinate space (sub-comp dimensions, not main canvas).
 */
export const CompositionContent = React.memo<CompositionContentProps>(({ item, parentMuted = false, renderDepth = 0 }) => {
  const subComp = useCompositionsStore((s) => s.compositions.find((c) => c.id === item.compositionId));
  const { width: canvasWidth, height: canvasHeight, fps: mainFps } = useVideoConfig();

  // Re-render when blob URLs are acquired (fixes media not loading on project load)
  const blobUrlVersion = useBlobUrlVersion();

  // Resolve media URLs for sub-comp items so they can render in preview
  const resolvedItems = useMemo(() => {
    if (!subComp) return [];
    return subComp.items.map(resolveSubCompItem);
  }, [subComp, blobUrlVersion]);

  // === Compute parent container dimensions ===
  // Replicates the same priority chain as useItemVisualState:
  // unified preview > gizmo preview > keyframes > base
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  const contextKeyframes = useItemKeyframesFromContext(item.id);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === item.id),
      [item.id]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;

  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const relativeFrame = frame - ((item as TimelineItem & { _sequenceFrameOffset?: number })._sequenceFrameOffset ?? 0);

  const containerDims = useMemo(() => {
    const canvas = { width: canvasWidth, height: canvasHeight, fps: mainFps };
    const sourceDims = getSourceDimensions(item);
    const baseResolved = resolveTransform(item, canvas, sourceDims);

    // Apply keyframe animation if present
    let animatedResolved = baseResolved;
    if (itemKeyframes && hasKeyframeAnimation(itemKeyframes)) {
      animatedResolved = resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
    }

    // Priority: unified preview > gizmo preview > keyframes > base
    let resolved = animatedResolved;
    const unifiedPreviewTransform = itemPreview?.transform;
    if (unifiedPreviewTransform !== undefined) {
      resolved = {
        ...animatedResolved,
        ...unifiedPreviewTransform,
        cornerRadius: unifiedPreviewTransform.cornerRadius ?? animatedResolved.cornerRadius,
      } as ResolvedTransform;
    } else if (activeGizmo?.itemId === item.id && previewTransform !== null) {
      resolved = {
        ...previewTransform,
        cornerRadius: previewTransform.cornerRadius ?? animatedResolved.cornerRadius,
      };
    }

    return { width: resolved.width, height: resolved.height };
  }, [canvasWidth, canvasHeight, mainFps, item, itemKeyframes, relativeFrame, itemPreview, activeGizmo, previewTransform]);

  if (!subComp) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#2a1a2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#a855f7', fontSize: 14 }}>Composition not found</p>
      </AbsoluteFill>
    );
  }

  // CSS scale from sub-comp native resolution to parent container dimensions
  const scaleX = subComp.width > 0 ? containerDims.width / subComp.width : 1;
  const scaleY = subComp.height > 0 ? containerDims.height / subComp.height : 1;

  // Sort tracks so lower order renders first (bottom), higher order on top
  const sortedTracks = [...subComp.tracks].sort((a, b) => b.order - a.order);

  return (
    <div style={{
      width: subComp.width,
      height: subComp.height,
      transform: `scale(${scaleX}, ${scaleY})`,
      transformOrigin: '0 0',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <VideoConfigProvider
        width={subComp.width}
        height={subComp.height}
        fps={subComp.fps}
        durationInFrames={subComp.durationInFrames}
      >
        <AbsoluteFill>
          {sortedTracks.map((track) => {
            if (!track.visible) return null;

            const trackItems = resolvedItems.filter((i) => i.trackId === track.id);

            return trackItems.map((subItem) => (
              <Sequence
                key={subItem.id}
                from={subItem.from}
                durationInFrames={subItem.durationInFrames}
              >
                <Item item={subItem} muted={parentMuted || track.muted} masks={[]} renderDepth={renderDepth} />
              </Sequence>
            ));
          })}
        </AbsoluteFill>
      </VideoConfigProvider>
    </div>
  );
});
