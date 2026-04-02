import { memo, useEffect, useMemo, useState } from 'react';
import type { CompositionInputProps } from '@/types/export';
import {
  PlayerEmitterProvider,
  ClockBridgeProvider,
  VideoConfigProvider,
  useClock,
} from '@/features/preview/deps/player-context';
import { usePlaybackStore } from '@/shared/state/playback';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import {
  buildSubCompositionInput,
  collectSubCompositionMediaIds,
  useCompositionsStore,
} from '@/features/preview/deps/timeline-contract';
import { resolveMediaUrl, resolveMediaUrls } from '@/features/preview/deps/media-library-contract';
import {
  MainComposition,
} from '@/features/preview/deps/composition-runtime-contract';

interface InlineCompositionPreviewProps {
  compositionId: string;
  seekFrame: number | null;
  containerSize: {
    width: number;
    height: number;
  };
}

function InlineCompositionPreviewClockSync({ frame }: { frame: number | null }) {
  const clock = useClock();

  useEffect(() => {
    clock.seekToFrame(frame ?? 0);
  }, [clock, frame]);

  return null;
}

export const InlineCompositionPreview = memo(function InlineCompositionPreview({
  compositionId,
  seekFrame,
  containerSize,
}: InlineCompositionPreviewProps) {
  const composition = useCompositionsStore((s) => s.compositionById[compositionId]);
  const compositionById = useCompositionsStore((s) => s.compositionById);
  const zoom = usePlaybackStore((s) => s.zoom);
  const [resolvedTracks, setResolvedTracks] = useState<CompositionInputProps['tracks'] | null>(null);

  const compositionInput = useMemo(
    () => (composition ? buildSubCompositionInput(composition) : null),
    [composition],
  );

  useEffect(() => {
    if (!composition || !compositionInput) {
      setResolvedTracks(null);
      return;
    }

    let cancelled = false;
    setResolvedTracks(null);

    const loadResolvedTracks = async () => {
      const mediaIds = collectSubCompositionMediaIds(compositionId, compositionById);
      await Promise.all(mediaIds.map((mediaId) => resolveMediaUrl(mediaId)));

      const nextResolvedTracks = await resolveMediaUrls(compositionInput.tracks, { useProxy: false });
      if (!cancelled) {
        setResolvedTracks(nextResolvedTracks);
      }
    };

    void loadResolvedTracks().catch(() => {
      if (!cancelled) {
        setResolvedTracks([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [composition, compositionById, compositionId, compositionInput]);

  const compositionWidth = composition?.width || 640;
  const compositionHeight = composition?.height || 360;
  const clampedSeekFrame = Math.min(
    Math.max(1, composition?.durationInFrames ?? 1) - 1,
    Math.max(0, seekFrame ?? 0),
  );

  const playerSize = useMemo(() => {
    const aspectRatio = compositionWidth / compositionHeight;

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

      return { width: compositionWidth, height: compositionHeight };
    }

    return {
      width: compositionWidth * zoom,
      height: compositionHeight * zoom,
    };
  }, [compositionHeight, compositionWidth, containerSize.height, containerSize.width, zoom]);

  const needsOverflow = useMemo(() => {
    if (zoom === -1) return false;
    if (containerSize.width === 0 || containerSize.height === 0) return false;
    return playerSize.width > containerSize.width || playerSize.height > containerSize.height;
  }, [containerSize.height, containerSize.width, playerSize.height, playerSize.width, zoom]);

  if (!composition || !compositionInput) {
    return (
      <div className="w-full h-full bg-video-preview-background flex items-center justify-center text-sm text-muted-foreground">
        Loading compound clip...
      </div>
    );
  }

  const durationInFrames = Math.max(1, composition.durationInFrames);

  return (
    <div
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      aria-label="Inline compound clip preview"
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
            {resolvedTracks ? (
              <PlayerEmitterProvider>
                <ClockBridgeProvider
                  fps={composition.fps}
                  durationInFrames={durationInFrames}
                  initialFrame={clampedSeekFrame}
                  onVolumeChange={() => {}}
                >
                  <VideoConfigProvider
                    fps={composition.fps}
                    width={composition.width}
                    height={composition.height}
                    durationInFrames={durationInFrames}
                  >
                    <InlineCompositionPreviewClockSync frame={clampedSeekFrame} />
                    <MainComposition
                      {...compositionInput}
                      tracks={resolvedTracks}
                    />
                  </VideoConfigProvider>
                </ClockBridgeProvider>
              </PlayerEmitterProvider>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                Loading compound clip...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
