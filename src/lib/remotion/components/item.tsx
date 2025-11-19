import React from 'react';
import { AbsoluteFill, OffthreadVideo, Audio } from 'remotion';
import type { TimelineItem } from '@/types/timeline';

export interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
}

/**
 * Remotion Item Component
 *
 * Renders different item types following Remotion best practices:
 * - Video: Uses OffthreadVideo for better performance with trim support
 * - Audio: Uses Audio component with trim support
 * - Image: Uses img tag
 * - Text: Renders text with styling
 * - Shape: Renders solid colors or shapes
 * - Respects mute state for audio/video items
 * - Supports trimStart/trimEnd for media trimming (uses trimStart as trimBefore)
 */
export const Item: React.FC<ItemProps> = ({ item, muted = false }) => {
  if (item.type === 'video') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Media not loaded</p>
        </AbsoluteFill>
      );
    }
    // Use trimStart if available, fallback to offset for backward compatibility
    const trimBefore = item.trimStart ?? item.offset ?? 0;
    return (
      <OffthreadVideo
        src={item.src}
        trimBefore={trimBefore}
        volume={muted ? 0 : 1}
      />
    );
  }

  if (item.type === 'audio') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return null; // Audio can fail silently
    }
    // Use trimStart if available, fallback to offset for backward compatibility
    const trimBefore = item.trimStart ?? item.offset ?? 0;
    return (
      <Audio
        src={item.src}
        trimBefore={trimBefore}
        volume={muted ? 0 : 1}
      />
    );
  }

  if (item.type === 'image') {
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Image not loaded</p>
        </AbsoluteFill>
      );
    }
    return (
      <AbsoluteFill>
        <img
          src={item.src}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
      </AbsoluteFill>
    );
  }

  if (item.type === 'text') {
    return (
      <AbsoluteFill
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: item.fontSize || 60,
            fontFamily: item.fontFamily || 'Arial, sans-serif',
            color: item.color,
            textAlign: 'center',
          }}
        >
          {item.text}
        </h1>
      </AbsoluteFill>
    );
  }

  if (item.type === 'shape') {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: item.fillColor
        }}
      />
    );
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
};
