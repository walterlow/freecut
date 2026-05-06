import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { MoreHorizontal, Palette } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/ui/cn'
import { useLibraryPalette } from '../hooks/use-library-palette'
import { useSceneBrowserStore } from '../stores/scene-browser-store'
import { labToRgb } from '../utils/color-convert'

/**
 * Color Mode picker — a weighted-k-means grid of the library's actual
 * dominant colors. Clicking a swatch pins it as a single-entry reference
 * palette, which the existing ranker turns into a similarity search.
 *
 * The grid caps at two visible rows. When more swatches exist than fit,
 * the tail collapses behind a "+N" button that opens a flyout containing
 * every cluster. The auto-fill track sizing keeps the visible rows tidy
 * at any container width; the overflow button always occupies the last
 * grid cell so the rows stay aligned.
 */

interface LibraryPaletteGridProps {
  scope: string | null
  className?: string
}

const SWATCH_SIZE_PX = 22
const GAP_PX = 4
const MAX_ROWS = 2

interface Cluster {
  l: number
  a: number
  b: number
  weight: number
}

export const LibraryPaletteGrid = memo(function LibraryPaletteGrid({
  scope,
  className,
}: LibraryPaletteGridProps) {
  const clusters = useLibraryPalette(scope)
  const setReference = useSceneBrowserStore((s) => s.setReference)
  const setQuery = useSceneBrowserStore((s) => s.setQuery)
  const currentRef = useSceneBrowserStore((s) => s.reference)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const width = el.clientWidth
      if (width <= 0) return
      // Match the grid's auto-fill math: floor((W + gap) / (size + gap)).
      const perRow = Math.max(1, Math.floor((width + GAP_PX) / (SWATCH_SIZE_PX + GAP_PX)))
      setColumns(perRow)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handlePick = useCallback(
    (cluster: Cluster) => {
      setQuery('')
      setReference({
        sceneId: `library-color-${Math.round(cluster.l)}-${Math.round(cluster.a)}-${Math.round(cluster.b)}`,
        label: 'Library color',
        palette: [{ l: cluster.l, a: cluster.a, b: cluster.b, weight: 1 }],
      })
    },
    [setQuery, setReference],
  )

  if (clusters.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-[12px] text-muted-foreground',
          className,
        )}
      >
        <Palette className="h-3.5 w-3.5" />
        <span>No palettes indexed yet — run AI captioning to populate.</span>
      </div>
    )
  }

  const totalWeight = clusters.reduce((sum, c) => sum + c.weight, 0) || 1
  const capacity = columns > 0 ? columns * MAX_ROWS : clusters.length
  const overflow = columns > 0 && clusters.length > capacity
  // Reserve the last cell for the "more" button when overflowing so rows
  // stay aligned. Otherwise show every cluster.
  const visibleCount = overflow ? capacity - 1 : clusters.length
  const visible = clusters.slice(0, visibleCount)
  const hidden = overflow ? clusters.slice(visibleCount) : []

  return (
    <div
      ref={containerRef}
      className={cn('grid w-full', className)}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${SWATCH_SIZE_PX}px, 1fr))`,
        gap: `${GAP_PX}px`,
      }}
    >
      {visible.map((cluster, i) => (
        <SwatchButton
          key={`v-${i}`}
          cluster={cluster}
          totalWeight={totalWeight}
          active={isActiveRef(cluster, currentRef)}
          onPick={handlePick}
        />
      ))}
      {overflow && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex aspect-square items-center justify-center rounded-md border border-white/10',
                'bg-secondary/60 text-muted-foreground transition-all',
                'hover:-translate-y-0.5 hover:text-foreground hover:shadow-md',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
              title={`${hidden.length} more color${hidden.length === 1 ? '' : 's'}`}
              aria-label={`Show ${hidden.length} more colors`}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <div className="mb-1.5 flex items-center justify-between px-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <span>More colors</span>
              <span>{hidden.length}</span>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${SWATCH_SIZE_PX}px, 1fr))`,
                gap: `${GAP_PX}px`,
              }}
            >
              {hidden.map((cluster, i) => (
                <SwatchButton
                  key={`h-${i}`}
                  cluster={cluster}
                  totalWeight={totalWeight}
                  active={isActiveRef(cluster, currentRef)}
                  onPick={handlePick}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
})

function SwatchButton({
  cluster,
  totalWeight,
  active,
  onPick,
}: {
  cluster: Cluster
  totalWeight: number
  active: boolean
  onPick: (cluster: Cluster) => void
}) {
  const [r, g, b] = labToRgb(cluster.l, cluster.a, cluster.b)
  const share = cluster.weight / totalWeight
  const label = `Find scenes in this color (${Math.round(share * 100)}% of the library)`
  return (
    <button
      type="button"
      onClick={() => onPick(cluster)}
      className={cn(
        'aspect-square rounded-md border border-white/10 transition-all',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary',
        active && 'ring-2 ring-primary',
      )}
      style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
      title={label}
      aria-label={label}
    />
  )
}

function isActiveRef(
  cluster: Cluster,
  ref: { palette: ReadonlyArray<{ l: number; a: number; b: number }> } | null,
): boolean {
  if (!ref || ref.palette.length !== 1) return false
  const first = ref.palette[0]!
  return first.l === cluster.l && first.a === cluster.a && first.b === cluster.b
}
