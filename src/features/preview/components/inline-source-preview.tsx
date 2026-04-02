import { memo, useEffect, useMemo, useState } from 'react';
import {
  PlayerEmitterProvider,
  ClockBridgeProvider,
  VideoConfigProvider,
  useClock,
} from '@/features/preview/deps/player-context';
import { useMediaLibraryStore, getMediaType } from '@/features/preview/deps/media-library';
import { resolveMediaUrl } from '../utils/media-resolver';
import { SourceComposition } from './source-composition';
import { usePlaybackStore } from '@/shared/state/playback';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';

interface InlineSourcePreviewProps {
  mediaId: string;
  seekFrame: number | null;
  containerSize: {
    width: number;
    height: number;
  };
}

function InlineSourcePreviewClockSync({ frame }: { frame: number | null }) {
  const clock = useClock();

  useEffect(() => {
    clock.seekToFrame(frame ?? 0);
  }, [clock, frame]);

  return null;
}

export const InlineSourcePreview = memo(function InlineSourcePreview({
  mediaId,
  seekFrame,
  containerSize,
}: InlineSourcePreviewProps) {
  const [blobUrl, setBlobUrl] = useState('');
  const media = useMediaLibraryStore((s) => s.mediaById[mediaId]);
  const zoom = usePlaybackStore((s) => s.zoom);
  const mediaWidth = media?.width || 640;
  const mediaHeight = media?.height || 360;

  useEffect(() => {
    let cancelled = false;
    setBlobUrl('');

    resolveMediaUrl(mediaId).then((url) => {
      if (!cancelled) {
        setBlobUrl(url);
      }
    }).catch(() => {
      // Resolution failures are already logged upstream.
    });

    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const playerSize = useMemo(() => {
    const aspectRatio = mediaWidth / mediaHeight;

    if (zoom === -1) {
      if (containerSize.width > 0 && containerSize.height > 0) {
        const containerAspectRatio = containerSize.width / containerSize.height;

        if (containerAspectRatio > aspectRatio) {
          const height = containerSize.height;
          return { width: height * aspectRatio, height };
        }

        const width = containerSize.width;
        return { width, height: width / aspectRatio };
      }

      return { width: mediaWidth, height: mediaHeight };
    }

    return {
      width: mediaWidth * zoom,
      height: mediaHeight * zoom,
    };
  }, [containerSize.height, containerSize.width, mediaHeight, mediaWidth, zoom]);

  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false;
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [containerSize.height, containerSize.width, playerSize.height, playerSize.width, zoom]);

  if (!media) {
    return (
      <div className="w-full h-full bg-video-preview-background flex items-center justify-center text-sm text-muted-foreground">
        Loading media...
      </div>
    );
  }

  const mediaType = getMediaType(media.mimeType);
  if (mediaType === 'unknown') {
    return null;
  }

  const fps = media.fps || 30;
  const durationInFrames = mediaType === 'image'
    ? 1
    : Math.max(1, Math.round(media.duration * fps));

  return (
    <div
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      aria-label="Inline media preview"
    >
      <div
        className="min-w-full min-h-full grid place-items-center"
        style={{ padding: `calc(${EDITOR_LAYOUT_CSS_VALUES.previewPadding} / 2)` }}
      >
        <div className="relative">
          <div
            className="relative shadow-2xl overflow-hidden"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
          >
            {blobUrl ? (
              <PlayerEmitterProvider>
                <ClockBridgeProvider
                  fps={fps}
                  durationInFrames={durationInFrames}
                  initialFrame={seekFrame ?? 0}
                  onVolumeChange={() => {}}
                >
                  <VideoConfigProvider
                    fps={fps}
                    width={mediaWidth}
                    height={mediaHeight}
                    durationInFrames={durationInFrames}
                  >
                    <InlineSourcePreviewClockSync frame={seekFrame} />
                    <SourceComposition
                      mediaId={mediaId}
                      src={blobUrl}
                      mediaType={mediaType}
                      fileName={media.fileName}
                    />
                  </VideoConfigProvider>
                </ClockBridgeProvider>
              </PlayerEmitterProvider>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                Loading media...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
