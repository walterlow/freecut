import React from 'react';
import type { VideoItem } from '@/types/timeline';

/**
 * Preview video is now fully canvas-owned.
 *
 * The hidden Player tree still renders the composition for timing/state, but it
 * should not mount native preview video elements anymore. Keep a stable
 * placeholder so the React structure remains intact while visible video frames
 * come from the rendered-preview or streaming canvas paths.
 */
export const VideoContent: React.FC<{
  item: VideoItem & { _sequenceFrameOffset?: number; _poolClipId?: string };
  safeTrimBefore: number;
  playbackRate: number;
  sourceFps: number;
  forceCssComposite?: boolean;
}> = ({ item }) => {
  return (
    <div
      data-detached-preview-video={item.id}
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
};
