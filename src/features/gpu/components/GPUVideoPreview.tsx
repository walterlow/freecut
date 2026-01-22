/**
 * GPUVideoPreview Component
 *
 * Alternative video preview that uses GPU rendering instead of HTML5 video elements.
 * Provides frame-accurate seeking and GPU-accelerated compositing.
 *
 * Features:
 * - WebCodecs/FFmpeg hybrid decoding
 * - GPU texture compositing
 * - Frame-accurate seeking (scrubbing)
 * - Multi-track video support
 *
 * Use this for:
 * - Timeline scrubbing (frame-accurate)
 * - Effect previews
 * - Export rendering
 *
 * Use HTML5 video (PooledVideoLayer) for:
 * - Real-time playback
 * - Audio sync
 */

import React, { useMemo, useCallback, memo } from 'react';
import { CanvasCompositor, type VideoLayer } from './CanvasCompositor';

// Types matching the timeline system
interface VideoItemData {
  id: string;
  type: 'video';
  src: string;
  from: number;
  durationInFrames: number;
  sourceStart?: number;
  sourceEnd?: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  trackId: string;
  trackOrder?: number;
  trackVisible?: boolean;
  opacity?: number;
  transform?: {
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  };
}

interface Track {
  id: string;
  order: number;
  visible: boolean;
  muted: boolean;
  solo: boolean;
}

export interface GPUVideoPreviewProps {
  /** Video items from the timeline */
  items: VideoItemData[];
  /** Tracks for visibility/ordering */
  tracks: Track[];
  /** Current frame number */
  currentFrame: number;
  /** Frames per second */
  fps: number;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Background color */
  backgroundColor?: string;
  /** Whether GPU rendering is enabled (can fallback to HTML5) */
  gpuEnabled?: boolean;
  /** Callback when a frame is rendered */
  onFrameRendered?: (frame: number) => void;
  /** Callback on render error */
  onError?: (error: Error) => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/**
 * GPU-accelerated video preview component
 *
 * Converts timeline items to video layers and renders through the GPU compositor.
 */
export const GPUVideoPreview = memo<GPUVideoPreviewProps>(
  ({
    items,
    tracks,
    currentFrame,
    fps,
    width,
    height,
    backgroundColor = '#000000',
    gpuEnabled = true,
    onFrameRendered,
    onError,
    className,
    style,
  }) => {
    // Create a map of track visibility and order
    const trackInfo = useMemo(() => {
      const map = new Map<string, { visible: boolean; order: number }>();
      for (const track of tracks) {
        map.set(track.id, {
          visible: track.visible,
          order: track.order,
        });
      }
      return map;
    }, [tracks]);

    // Convert video items to VideoLayer format
    const videoLayers = useMemo((): VideoLayer[] => {
      return items
        .filter((item) => {
          // Filter out items on hidden tracks
          const track = trackInfo.get(item.trackId);
          return track?.visible !== false && (item.trackVisible ?? true);
        })
        .map((item): VideoLayer => {
          const track = trackInfo.get(item.trackId);
          const zIndex = track?.order ?? 0;

          return {
            id: item.id,
            src: item.src,
            from: item.from,
            durationInFrames: item.durationInFrames,
            sourceStart: item.sourceStart,
            speed: item.speed,
            zIndex,
            opacity: item.opacity,
            transform: item.transform,
          };
        })
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    }, [items, trackInfo]);

    // Error handler
    const handleError = useCallback(
      (error: Error) => {
        console.error('[GPUVideoPreview] Error:', error);
        onError?.(error);
      },
      [onError]
    );

    if (!gpuEnabled) {
      // Fallback message - in production, would render HTML5 video fallback
      return (
        <div
          className={className}
          style={{
            width,
            height,
            backgroundColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
            ...style,
          }}
        >
          GPU rendering disabled
        </div>
      );
    }

    return (
      <CanvasCompositor
        layers={videoLayers}
        currentFrame={currentFrame}
        fps={fps}
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        onFrameRendered={onFrameRendered}
        onError={handleError}
        className={className}
        style={style}
      />
    );
  }
);

GPUVideoPreview.displayName = 'GPUVideoPreview';

export default GPUVideoPreview;
