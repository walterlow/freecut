import { memo } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { ClipFilmstrip } from '../clip-filmstrip';
import { ClipWaveform } from '../clip-waveform';
import {
  CLIP_LABEL_HEIGHT,
  VIDEO_FILMSTRIP_HEIGHT,
  VIDEO_WAVEFORM_HEIGHT,
  AUDIO_WAVEFORM_HEIGHT,
} from '@/features/timeline/constants';

export interface ClipContentProps {
  item: TimelineItem;
  clipWidth: number;
  fps: number;
  isClipVisible: boolean;
  pixelsPerSecond: number;
}

/**
 * Renders the visual content of a timeline clip based on its type.
 * - Video: Filmstrip with overlayed label + waveform
 * - Audio: Label + waveform
 * - Text: Text content preview
 * - Adjustment: Effects summary
 * - Image/Shape: Simple label
 */
export const ClipContent = memo(function ClipContent({
  item,
  clipWidth,
  fps,
  isClipVisible,
  pixelsPerSecond,
}: ClipContentProps) {
  const sourceStart = (item.sourceStart ?? 0) / fps;
  const sourceDuration = (item.sourceDuration ?? item.durationInFrames) / fps;
  const trimStart = (item.trimStart ?? 0) / fps;
  const speed = item.speed ?? 1;

  // Video clip 2-row layout: filmstrip (with overlayed label) | waveform
  if (item.type === 'video' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Filmstrip with overlayed label */}
        <div className="relative overflow-hidden" style={{ height: VIDEO_FILMSTRIP_HEIGHT }}>
          <ClipFilmstrip
            mediaId={item.mediaId}
            clipWidth={clipWidth}
            sourceStart={sourceStart}
            sourceDuration={sourceDuration}
            trimStart={trimStart}
            speed={speed}
            fps={fps}
            isVisible={isClipVisible}
            pixelsPerSecond={pixelsPerSecond}
            height={VIDEO_FILMSTRIP_HEIGHT}
            className="top-0"
          />
          {/* Overlayed label */}
          <div
            className="absolute top-0 left-0 max-w-full px-2 text-[11px] font-medium truncate"
            style={{ lineHeight: `${CLIP_LABEL_HEIGHT}px` }}
          >
            {item.label}
          </div>
        </div>
        {/* Row 2: Waveform */}
        <div className="relative overflow-hidden" style={{ height: VIDEO_WAVEFORM_HEIGHT }}>
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
            height={VIDEO_WAVEFORM_HEIGHT}
            className="top-0"
          />
        </div>
      </div>
    );
  }

  // Audio clip 2-row layout: label | waveform
  if (item.type === 'audio' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label */}
        <div
          className="px-2 text-[11px] font-medium truncate"
          style={{ height: CLIP_LABEL_HEIGHT, lineHeight: `${CLIP_LABEL_HEIGHT}px` }}
        >
          {item.label}
        </div>
        {/* Row 2: Waveform */}
        <div className="relative overflow-hidden" style={{ height: AUDIO_WAVEFORM_HEIGHT }}>
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
            height={AUDIO_WAVEFORM_HEIGHT}
            className="top-0"
          />
        </div>
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
