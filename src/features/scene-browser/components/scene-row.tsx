import { memo, useCallback, useMemo } from 'react';
import { Clock, Film, Palette, Search } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { formatDuration } from '../deps/media-library';
import { useCaptionThumbnail } from '../hooks/use-caption-thumbnail';
import { useSceneBrowserStore } from '../stores/scene-browser-store';
import { nearestColorFamily } from '../utils/color-boost';
import { seekToScene } from '../utils/seek';
import { HighlightedText } from './highlighted-text';
import { SceneMatchBadges, SceneMatchStrength } from './scene-match-badges';
import { ScenePaletteSwatches } from './scene-palette-swatches';
import type { ScoredScene } from '../utils/rank';

interface SceneRowProps {
  scene: ScoredScene;
  /** When true, render the source filename line — hidden in per-media scope. */
  showMediaName: boolean;
  /** True when this row is the first result for the active query. */
  isTop?: boolean;
  /** Only render match signal chrome when a query is active. */
  showSignals?: boolean;
}

function formatSceneTimestamp(sec: number): string {
  return formatDuration(sec);
}

function parseCaptionIndex(sceneId: string): number | null {
  const idx = sceneId.lastIndexOf(':');
  if (idx < 0) return null;
  const parsed = Number(sceneId.slice(idx + 1));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const SceneRow = memo(function SceneRow({
  scene,
  showMediaName,
  isTop,
  showSignals,
}: SceneRowProps) {
  const captionIndex = parseCaptionIndex(scene.id);
  const thumbUrl = useCaptionThumbnail(
    scene.thumbRelPath,
    scene.thumbRelPath || captionIndex === null
      ? undefined
      : { mediaId: scene.mediaId, captionIndex, timeSec: scene.timeSec },
  );

  const handleOpen = useCallback(() => {
    seekToScene(scene.mediaId, scene.timeSec);
  }, [scene.mediaId, scene.timeSec]);

  const setQuery = useSceneBrowserStore((s) => s.setQuery);
  const setReference = useSceneBrowserStore((s) => s.setReference);
  const colorMode = useSceneBrowserStore((s) => s.colorMode);

  const handleSwatchClick = useCallback((swatch: { l: number; a: number; b: number }) => {
    if (colorMode) {
      setReference({
        sceneId: `swatch-${Math.round(swatch.l)}-${Math.round(swatch.a)}-${Math.round(swatch.b)}`,
        label: 'Picked swatch',
        palette: [{ l: swatch.l, a: swatch.a, b: swatch.b, weight: 1 }],
      });
      return;
    }
    const family = nearestColorFamily(swatch);
    if (!family) return;
    setReference(null);
    setQuery(family);
  }, [colorMode, setQuery, setReference]);

  const handleFindSimilarPalette = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (!scene.palette || scene.palette.length === 0) return;
    setQuery('');
    setReference({
      sceneId: scene.id,
      label: `${scene.mediaFileName} · ${formatSceneTimestamp(scene.timeSec)}`,
      palette: scene.palette.map((p) => ({ l: p.l, a: p.a, b: p.b, weight: p.weight })),
    });
  }, [scene.id, scene.mediaFileName, scene.palette, scene.timeSec, setQuery, setReference]);

  const handleDragStart = useCallback((event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'scene-drop' as const,
        mediaId: scene.mediaId,
        fileName: scene.mediaFileName,
        startSec: scene.timeSec,
      }),
    );
  }, [scene.mediaFileName, scene.mediaId, scene.timeSec]);

  const timestampLabel = useMemo(() => formatSceneTimestamp(scene.timeSec), [scene.timeSec]);

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={handleOpen}
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border border-transparent px-2 py-2',
        'text-left transition-colors',
        'hover:border-border/60 hover:bg-foreground/5 focus-visible:outline-none',
        'focus-visible:border-primary/60 focus-visible:bg-primary/10',
        // A subtle backdrop on the top match so it stands out without
        // stealing focus from lower-scoring but still-relevant rows.
        showSignals && isTop && 'bg-primary/5',
      )}
      title="Click to preview in source monitor — drag to add to the timeline"
    >
      <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-md bg-secondary">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Film className="h-4 w-4" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Search className="h-4 w-4 text-white/90" />
        </div>
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[10px] leading-none text-white/90">
          {timestampLabel}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {showMediaName && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{scene.mediaFileName}</span>
          </div>
        )}
        <HighlightedText
          text={scene.text}
          spans={scene.matchSpans}
          className="line-clamp-3 text-[12px] leading-snug text-foreground"
        />
        {showSignals && (
          <div className="space-y-1 pt-0.5">
            <SceneMatchStrength signals={scene.signals} score={scene.score} />
            <div className="flex flex-wrap items-center gap-2">
              <SceneMatchBadges
                signals={scene.signals}
                score={scene.score}
                isTop={isTop}
              />
              <ScenePaletteSwatches
                palette={scene.palette}
                highlight={scene.signals.colorMatch ?? null}
                onSwatchClick={handleSwatchClick}
              />
              {scene.palette && scene.palette.length > 0 && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Find scenes with a similar palette"
                  title="Find scenes with a similar palette"
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
                  onClick={handleFindSimilarPalette}
                >
                  <Palette className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>
        )}
        {!showSignals && colorMode && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {scene.palette && scene.palette.length > 0 ? (
              <>
                <ScenePaletteSwatches
                  palette={scene.palette}
                  highlight={null}
                  onSwatchClick={handleSwatchClick}
                />
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Find scenes with a similar palette"
                  title="Find scenes with a similar palette"
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground"
                  onClick={handleFindSimilarPalette}
                >
                  <Palette className="h-3 w-3" />
                </span>
              </>
            ) : (
              <span className="text-[10px] italic text-muted-foreground/60">
                No palette indexed
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
});
