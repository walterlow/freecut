import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CompositionInputProps } from '@/types/export';
import { usePlaybackStore } from '@/shared/state/playback';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout';
import {
  buildSubCompositionInput,
  collectSubCompositionMediaIds,
  useCompositionsStore,
} from '@/features/preview/deps/timeline-contract';
import { resolveMediaUrl, resolveMediaUrls } from '@/features/preview/deps/media-library-contract';
import { createCompositionRenderer } from '@/features/preview/deps/export';
import { createLogger } from '@/shared/logging/logger';

type CompositionRendererInstance = Awaited<ReturnType<typeof createCompositionRenderer>>;

function getLogger() {
  return createLogger('InlineCompositionPreview');
}

interface InlineCompositionPreviewProps {
  compositionId: string;
  seekFrame: number | null;
  containerSize: {
    width: number;
    height: number;
  };
}

export const InlineCompositionPreview = memo(function InlineCompositionPreview({
  compositionId,
  seekFrame,
  containerSize,
}: InlineCompositionPreviewProps) {
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const requestKey = `${compositionId}:${useProxy ? 'proxy' : 'source'}`;

  return (
    <InlineCompositionPreviewContent
      key={requestKey}
      compositionId={compositionId}
      seekFrame={seekFrame}
      containerSize={containerSize}
    />
  );
});

const InlineCompositionPreviewContent = memo(function InlineCompositionPreviewContent({
  compositionId,
  seekFrame,
  containerSize,
}: InlineCompositionPreviewProps) {
  const composition = useCompositionsStore((s) => s.compositionById[compositionId]);
  const compositionById = useCompositionsStore((s) => s.compositionById);
  const zoom = usePlaybackStore((s) => s.zoom);
  const useProxy = usePlaybackStore((s) => s.useProxy);
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

      const nextResolvedTracks = await resolveMediaUrls(compositionInput.tracks, { useProxy });
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
  }, [composition, compositionById, compositionId, compositionInput, useProxy]);

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

  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CompositionRendererInstance | null>(null);
  const offscreenRef = useRef<OffscreenCanvas | null>(null);
  const [rendererReady, setRendererReady] = useState(false);

  const rendererInput = useMemo<CompositionInputProps | null>(() => {
    if (!compositionInput || !resolvedTracks) return null;
    return { ...compositionInput, tracks: resolvedTracks };
  }, [compositionInput, resolvedTracks]);

  useEffect(() => {
    if (!rendererInput) {
      setRendererReady(false);
      return;
    }
    if (typeof OffscreenCanvas === 'undefined') {
      setRendererReady(false);
      return;
    }

    let cancelled = false;
    let createdRenderer: CompositionRendererInstance | null = null;
    setRendererReady(false);

    const offscreen = new OffscreenCanvas(compositionWidth, compositionHeight);
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      return;
    }

    const boot = async () => {
      try {
        const renderer = await createCompositionRenderer(rendererInput, offscreen, ctx, {
          mode: 'preview',
        });
        if (cancelled) {
          renderer.dispose();
          return;
        }
        createdRenderer = renderer;
        rendererRef.current = renderer;
        offscreenRef.current = offscreen;

        if ('warmGpuPipeline' in renderer) {
          void renderer.warmGpuPipeline();
        }

        await renderer.preload({ priorityFrame: clampedSeekFrame });
        if (cancelled) return;

        setRendererReady(true);
      } catch (error) {
        if (!cancelled) {
          getLogger().warn('Failed to initialize inline composition renderer', { error });
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      if (createdRenderer) {
        try {
          createdRenderer.dispose();
        } catch (error) {
          getLogger().warn('Failed to dispose inline composition renderer', { error });
        }
      }
      if (rendererRef.current === createdRenderer) {
        rendererRef.current = null;
        offscreenRef.current = null;
      }
    };
  }, [rendererInput, compositionWidth, compositionHeight]);

  useEffect(() => {
    if (!rendererReady) return;
    const renderer = rendererRef.current;
    const offscreen = offscreenRef.current;
    const display = displayCanvasRef.current;
    if (!renderer || !offscreen || !display) return;

    let cancelled = false;

    const run = async () => {
      try {
        await renderer.renderFrame(clampedSeekFrame);
        if (cancelled) return;
        if (rendererRef.current !== renderer) return;
        const displayCtx = display.getContext('2d');
        if (!displayCtx) return;
        if (display.width !== offscreen.width || display.height !== offscreen.height) {
          display.width = offscreen.width;
          display.height = offscreen.height;
        }
        displayCtx.clearRect(0, 0, display.width, display.height);
        displayCtx.drawImage(offscreen, 0, 0, display.width, display.height);
      } catch (error) {
        if (!cancelled) {
          getLogger().debug('Inline composition frame render failed', { error, frame: clampedSeekFrame });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [clampedSeekFrame, rendererReady]);

  if (!composition || !compositionInput) {
    return (
      <div className="w-full h-full bg-video-preview-background flex items-center justify-center text-sm text-muted-foreground">
        Loading compound clip...
      </div>
    );
  }

  const showLoading = !resolvedTracks || !rendererReady;

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
            className="relative shadow-2xl overflow-hidden bg-black"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              outline: '2px solid hsl(var(--border))',
              outlineOffset: 0,
            }}
          >
            <canvas
              ref={displayCanvasRef}
              width={compositionWidth}
              height={compositionHeight}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
            {showLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-black/30">
                Loading compound clip...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
