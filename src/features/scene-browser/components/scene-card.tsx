import { memo, useCallback } from 'react'
import { Film, Palette, Search } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { formatDuration } from '../deps/media-library'
import { useCaptionThumbnail } from '../hooks/use-caption-thumbnail'
import { useSceneBrowserStore } from '../stores/scene-browser-store'
import { nearestColorFamily } from '../utils/color-boost'
import { seekToScene } from '../utils/seek'
import { SceneMatchBadges, SceneMatchStrength } from './scene-match-badges'
import { ScenePaletteSwatches } from './scene-palette-swatches'
import type { ScoredScene } from '../utils/rank'

interface SceneCardProps {
  scene: ScoredScene
  /** When true, render the source filename line — hidden in per-media scope. */
  showMediaName: boolean
  /** True when this card is the first result for the active query. */
  isTop?: boolean
  /** Only render match signal chrome when a query is active. */
  showSignals?: boolean
}

function parseCaptionIndex(sceneId: string): number | null {
  const idx = sceneId.lastIndexOf(':')
  if (idx < 0) return null
  const parsed = Number(sceneId.slice(idx + 1))
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export const SceneCard = memo(function SceneCard({
  scene,
  showMediaName,
  isTop,
  showSignals,
}: SceneCardProps) {
  const captionIndex = parseCaptionIndex(scene.id)
  const thumbUrl = useCaptionThumbnail(
    scene.thumbRelPath,
    scene.thumbRelPath || captionIndex === null
      ? undefined
      : { mediaId: scene.mediaId, captionIndex, timeSec: scene.timeSec },
  )

  const setQuery = useSceneBrowserStore((s) => s.setQuery)
  const setReference = useSceneBrowserStore((s) => s.setReference)
  const colorMode = useSceneBrowserStore((s) => s.colorMode)

  const handleOpen = useCallback(() => {
    seekToScene(scene.mediaId, scene.timeSec)
  }, [scene.mediaId, scene.timeSec])

  const handleSwatchClick = useCallback(
    (swatch: { l: number; a: number; b: number }) => {
      if (colorMode) {
        setReference({
          sceneId: `swatch-${Math.round(swatch.l)}-${Math.round(swatch.a)}-${Math.round(swatch.b)}`,
          label: 'Picked swatch',
          palette: [{ l: swatch.l, a: swatch.a, b: swatch.b, weight: 1 }],
        })
        return
      }
      const family = nearestColorFamily(swatch)
      if (!family) return
      setReference(null)
      setQuery(family)
    },
    [colorMode, setQuery, setReference],
  )

  const handleFindSimilarPalette = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!scene.palette || scene.palette.length === 0) return
      setQuery('')
      setReference({
        sceneId: scene.id,
        label: `${scene.mediaFileName} · ${formatDuration(scene.timeSec)}`,
        palette: scene.palette.map((p) => ({ l: p.l, a: p.a, b: p.b, weight: p.weight })),
      })
    },
    [scene.id, scene.mediaFileName, scene.palette, scene.timeSec, setQuery, setReference],
  )

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'scene-drop' as const,
          mediaId: scene.mediaId,
          fileName: scene.mediaFileName,
          startSec: scene.timeSec,
        }),
      )
    },
    [scene.mediaFileName, scene.mediaId, scene.timeSec],
  )

  const timestampLabel = formatDuration(scene.timeSec)
  const hasPalette = !!scene.palette && scene.palette.length > 0

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={handleOpen}
      className={cn(
        'group flex w-full flex-col overflow-hidden rounded-lg border border-transparent',
        'text-left transition-colors',
        'hover:border-border/60 hover:bg-foreground/5 focus-visible:outline-none',
        'focus-visible:border-primary/60 focus-visible:bg-primary/10',
        showSignals && isTop && 'border-primary/40 bg-primary/5',
      )}
      title="Click to preview in source monitor — drag to add to the timeline"
    >
      <div className="relative aspect-video max-h-32 w-full shrink-0 overflow-hidden rounded-md bg-secondary">
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
            <Film className="h-5 w-5" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Search className="h-5 w-5 text-white/90" />
        </div>
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] leading-none text-white/90">
          {timestampLabel}
        </span>
        {hasPalette && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Find scenes with a similar palette"
            title="Find scenes with a similar palette"
            className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
            onClick={handleFindSimilarPalette}
          >
            <Palette className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-1 px-1.5 py-1.5">
        {showMediaName && (
          <div className="truncate text-[10px] text-muted-foreground" title={scene.mediaFileName}>
            {scene.mediaFileName}
          </div>
        )}
        <div className="whitespace-normal break-words text-[11px] leading-snug text-foreground">
          {scene.text}
        </div>
        {showSignals && <SceneMatchStrength signals={scene.signals} score={scene.score} />}
        {(showSignals || (colorMode && hasPalette)) && (
          <div className="flex flex-wrap items-center gap-1">
            {showSignals && (
              <SceneMatchBadges signals={scene.signals} score={scene.score} isTop={isTop} />
            )}
            {hasPalette && (colorMode || showSignals) && (
              <ScenePaletteSwatches
                palette={scene.palette}
                highlight={showSignals ? (scene.signals.colorMatch ?? null) : null}
                onSwatchClick={handleSwatchClick}
              />
            )}
          </div>
        )}
      </div>
    </button>
  )
})
