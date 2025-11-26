import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig, useCurrentFrame } from 'remotion';
import type { RemotionInputProps } from '@/types/export';
import { Item } from '../components/item';
import { generateStableKey } from '../utils/generate-stable-key';

/**
 * Main Remotion Composition
 *
 * Renders all tracks following Remotion best practices:
 * - Media items (video/audio) rendered at composition level for stable keys
 *   This prevents remounting when items are split or moved across tracks
 * - Non-media items (text, images, shapes) rendered per-track
 * - Z-index based on track order for proper layering (top track = highest z-index)
 * - Respects track visibility, mute, and solo states
 * - Pre-mounts media items 2 seconds early for smooth transitions
 */
export const MainComposition: React.FC<RemotionInputProps> = ({ tracks }) => {
  const { fps } = useVideoConfig();
  const currentFrame = useCurrentFrame();
  const hasSoloTracks = tracks.some((track) => track.solo);

  // Calculate max order for z-index inversion (top track should have highest z-index)
  const maxOrder = Math.max(...tracks.map((t) => t.order ?? 0), 0);

  // Filter visible tracks (tracks are already sorted by store)
  const visibleTracks = tracks.filter((track) => {
    if (hasSoloTracks) return track.solo;
    return track.visible !== false;
  });

  // Collect ALL media items (video/audio) from visible tracks with z-index and mute state
  // Invert z-index: top track (order=0) gets highest z-index, bottom track gets lowest
  const mediaItems = visibleTracks.flatMap((track) =>
    track.items
      .filter((item) => item.type === 'video' || item.type === 'audio')
      .map((item) => ({
        ...item,
        zIndex: maxOrder - (track.order ?? 0),
        muted: track.muted,
      }))
  );

  // Collect non-media items per track (text, image, shape)
  const nonMediaByTrack = visibleTracks.map((track) => ({
    ...track,
    items: track.items.filter(
      (item) => item.type !== 'video' && item.type !== 'audio'
    ),
  }));

  // Check if any VIDEO items (not audio) are active at current frame
  // Used to render a clearing layer when no videos are visible
  const hasActiveVideo = mediaItems.some(
    (item) =>
      item.type === 'video' &&
      currentFrame >= item.from &&
      currentFrame < item.from + item.durationInFrames
  );

  return (
    <AbsoluteFill>
      {/* BACKGROUND LAYER - Ensures empty areas show black instead of last frame */}
      <AbsoluteFill style={{ backgroundColor: '#000000', zIndex: -1 }} />

      {/* MEDIA LAYER - All video/audio at composition level (prevents cross-track remounts) */}
      {/* z-index: 0-999 range for media items */}
      {mediaItems.map((item) => {
        const premountFrames = Math.round(fps * 2);
        return (
          <Sequence
            key={generateStableKey(item)}
            from={item.from}
            durationInFrames={item.durationInFrames}
            premountFor={premountFrames}
          >
            <AbsoluteFill style={{ zIndex: item.zIndex }}>
              <Item item={item} muted={item.muted} />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* CLEARING LAYER - Paints black over stale video frames when no videos are active */}
      {/* z-index: 1000 - above media (0-999), below non-media (1001+) */}
      {!hasActiveVideo && (
        <AbsoluteFill style={{ backgroundColor: '#000000', zIndex: 1000 }} />
      )}

      {/* NON-MEDIA LAYERS - Track-based rendering for text/shapes/images */}
      {/* z-index: 1001+ range so they appear above clearing layer */}
      {/* Invert z-index: top track (order=0) gets highest z-index */}
      {nonMediaByTrack
        .filter((track) => track.items.length > 0)
        .map((track) => (
          <AbsoluteFill key={track.id} style={{ zIndex: 1001 + (maxOrder - (track.order ?? 0)) }}>
            {track.items.map((item) => (
              <Sequence
                key={item.id}
                from={item.from}
                durationInFrames={item.durationInFrames}
              >
                <Item item={item} muted={false} />
              </Sequence>
            ))}
          </AbsoluteFill>
        ))}
    </AbsoluteFill>
  );
};
