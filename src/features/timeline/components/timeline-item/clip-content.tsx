import { memo, useCallback } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { ClipFilmstrip } from '../clip-filmstrip';
import { ClipWaveform } from '../clip-waveform';
import {
  CLIP_LABEL_ROW_HEIGHT,
  VIDEO_WAVEFORM_HEIGHT,
} from '@/features/timeline/constants';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useCompositionsStore } from '../../stores/compositions-store';

interface ClipContentProps {
  item: TimelineItem;
  clipWidth: number;
  fps: number;
  isClipVisible: boolean;
  visibleStartRatio?: number;
  visibleEndRatio?: number;
  pixelsPerSecond: number;
  preferImmediateRendering?: boolean;
}

/**
 * Renders the visual content of a timeline clip based on its type.
 * - Video: 3-row layout — label | filmstrip | waveform
 * - Audio: Label row + waveform
 * - Composition (with video): Same 3-row layout as video
 * - Text: Text content preview
 * - Adjustment: Effects summary
 * - Image/Shape: Simple label
 */
export const ClipContent = memo(function ClipContent({
  item,
  clipWidth,
  fps,
  isClipVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
  preferImmediateRendering = false,
}: ClipContentProps) {
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);

  // For composition items: find the topmost video in the sub-comp for filmstrip
  const compositionId = item.type === 'composition' ? item.compositionId : undefined;
  const compTopVideoMediaId = useCompositionsStore(
    useCallback((s) => {
      if (!compositionId) return null;
      const comp = s.compositionById[compositionId];
      if (!comp) return null;
      const trackOrderMap = new Map(comp.tracks.map((t) => [t.id, t.order ?? 0]));
      let topMediaId: string | null = null;
      let topOrder = Infinity;
      for (const ci of comp.items) {
        if (ci.type !== 'video' || !ci.mediaId) continue;
        const order = trackOrderMap.get(ci.trackId) ?? 0;
        if (order < topOrder) {
          topOrder = order;
          topMediaId = ci.mediaId;
        }
      }
      return topMediaId;
    }, [compositionId])
  );

  // Use topmost video's mediaId for composition items so filmstrip/source lookups work
  const effectiveMediaId = item.mediaId ?? compTopVideoMediaId;

  // sourceStart/sourceDuration are stored in source-frame units. Prefer duration-ratio
  // mapping so rendering remains stable even if media FPS metadata changes after drop.
  const sourceFps = useMediaLibraryStore(
    useCallback((s) => {
      if (!effectiveMediaId) return fps;
      const media = s.mediaById[effectiveMediaId];
      return media?.fps || fps;
    }, [effectiveMediaId, fps])
  );
  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => {
      if (!effectiveMediaId) return 0;
      const media = s.mediaById[effectiveMediaId];
      return media?.duration || 0;
    }, [effectiveMediaId])
  );

  const sourceDurationFrames = Math.max(1, item.sourceDuration ?? item.durationInFrames);
  const sourceStartFrames = Math.max(0, item.sourceStart ?? 0);

  const sourceDuration = mediaDuration > 0
    ? mediaDuration
    : (sourceDurationFrames / sourceFps);
  const sourceStart = mediaDuration > 0
    ? (sourceStartFrames / sourceDurationFrames) * mediaDuration
    : (sourceStartFrames / sourceFps);

  const trimStart = (item.trimStart ?? 0) / fps;
  const speed = item.speed ?? 1;

  // Video clip 3-row layout: label | filmstrip | waveform
  if (item.type === 'video' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{ height: CLIP_LABEL_ROW_HEIGHT, lineHeight: `${CLIP_LABEL_ROW_HEIGHT}px` }}
        >
          {item.label}
        </div>
        {/* Row 2: Filmstrip - flex-1 to fill remaining space */}
        <div className="relative overflow-hidden flex-1 min-h-0">
          {showFilmstrips && (
            <ClipFilmstrip
              mediaId={item.mediaId}
              clipWidth={clipWidth}
              sourceStart={sourceStart}
              sourceDuration={sourceDuration}
              trimStart={trimStart}
              speed={speed}
              fps={fps}
              isVisible={isClipVisible}
              visibleStartRatio={visibleStartRatio}
              visibleEndRatio={visibleEndRatio}
              pixelsPerSecond={pixelsPerSecond}
              preferImmediateRendering={preferImmediateRendering}
            />
          )}
        </div>
        {/* Row 3: Waveform - fixed height with gradient bg */}
        {showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient" style={{ height: VIDEO_WAVEFORM_HEIGHT }}>
            <ClipWaveform
              mediaId={item.mediaId}
              clipWidth={clipWidth}
              sourceStart={sourceStart}
              sourceDuration={sourceDuration}
              trimStart={trimStart}
              speed={speed}
              fps={fps}
              isVisible={isClipVisible}
              pixelsPerSecond={pixelsPerSecond}
            />
          </div>
        )}
      </div>
    );
  }

  // Audio clip - label row + waveform fills remaining space
  if (item.type === 'audio' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{ height: CLIP_LABEL_ROW_HEIGHT, lineHeight: `${CLIP_LABEL_ROW_HEIGHT}px` }}
        >
          {item.label}
        </div>
        {/* Row 2: Waveform - fills remaining space */}
        {showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <ClipWaveform
              mediaId={item.mediaId}
              clipWidth={clipWidth}
              sourceStart={sourceStart}
              sourceDuration={sourceDuration}
              trimStart={trimStart}
              speed={speed}
              fps={fps}
              isVisible={isClipVisible}
              pixelsPerSecond={pixelsPerSecond}
            />
          </div>
        )}
      </div>
    );
  }

  // Text item - show text content preview
  if (item.type === 'text') {
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Text</div>
        <div className="text-xs font-medium truncate flex-1">
          {item.text || 'Empty text'}
        </div>
      </div>
    );
  }

  // Composition item - filmstrip from topmost video in sub-comp, or label fallback
  if (item.type === 'composition') {
    if (compTopVideoMediaId) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {/* Row 1: Label - fixed height */}
          <div
            className="px-2 text-[11px] font-medium truncate shrink-0"
            style={{ height: CLIP_LABEL_ROW_HEIGHT, lineHeight: `${CLIP_LABEL_ROW_HEIGHT}px` }}
          >
            {item.label || 'Composition'}
          </div>
          {/* Row 2: Filmstrip - flex-1 */}
          <div className="relative overflow-hidden flex-1 min-h-0">
            {showFilmstrips && (
              <ClipFilmstrip
                mediaId={compTopVideoMediaId}
                clipWidth={clipWidth}
                sourceStart={sourceStart}
                sourceDuration={sourceDuration}
                trimStart={0}
                speed={1}
                fps={fps}
                isVisible={isClipVisible}
                visibleStartRatio={visibleStartRatio}
                visibleEndRatio={visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
                preferImmediateRendering={preferImmediateRendering}
              />
            )}
          </div>
          {/* Row 3: Waveform */}
          {showWaveforms && (
            <div className="relative overflow-hidden bg-waveform-gradient" style={{ height: VIDEO_WAVEFORM_HEIGHT }}>
              <ClipWaveform
                mediaId={compTopVideoMediaId}
                clipWidth={clipWidth}
                sourceStart={sourceStart}
                sourceDuration={sourceDuration}
                trimStart={0}
                speed={1}
                fps={fps}
                isVisible={isClipVisible}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Pre-Comp</div>
        <div className="text-xs font-medium truncate flex-1">
          {item.label || 'Composition'}
        </div>
      </div>
    );
  }

  // Adjustment layer - show effects summary
  if (item.type === 'adjustment') {
    const enabledEffectsCount = item.effects?.filter(e => e.enabled).length ?? 0;
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Adjustment Layer</div>
        <div className="text-xs font-medium truncate flex-1">
          {enabledEffectsCount > 0
            ? `${enabledEffectsCount} effect${enabledEffectsCount > 1 ? 's' : ''}`
            : 'No effects'}
        </div>
      </div>
    );
  }

  // Default for image and shape items - simple label
  return (
    <div className="px-2 py-1 text-xs font-medium truncate">
      {item.label}
    </div>
  );
});
