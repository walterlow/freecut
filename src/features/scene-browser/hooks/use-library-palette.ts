import { useMemo } from 'react'
import { useMediaLibraryStore } from '../deps/media-library'
import {
  clusterPaletteEntries,
  flattenLibraryPalettes,
  type LabCluster,
} from '../utils/library-palette'

/** Target cluster count. Capped further by how many palettes exist. */
const DEFAULT_K = 12

/**
 * Collect every caption's palette across the library and cluster them
 * into a small set of representative colors for the Color Mode picker.
 *
 * The hook reads from the media-library store (not the scene browser's
 * embeddings cache) because captions are the source of truth — the
 * palettes in `MediaCaption.palette` are what the ranker matches
 * against, so the grid must reflect the same data.
 */
export function useLibraryPalette(scope: string | null, k = DEFAULT_K): LabCluster[] {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)

  return useMemo(() => {
    const palettes: Array<ReadonlyArray<{ l: number; a: number; b: number; weight: number }>> = []
    for (const media of mediaItems) {
      if (scope && media.id !== scope) continue
      const captions = media.aiCaptions
      if (!captions || captions.length === 0) continue
      for (const caption of captions) {
        if (caption.palette && caption.palette.length > 0) {
          palettes.push(caption.palette)
        }
      }
    }
    if (palettes.length === 0) return []

    const flat = flattenLibraryPalettes(
      palettes.map((p) =>
        p.map((e) => ({
          l: e.l,
          a: e.a,
          b: e.b,
          weight: e.weight,
        })),
      ),
    )
    const clusters = clusterPaletteEntries(flat, k)

    // Sort by aggregate weight so the grid leads with the library's
    // dominant colors — skin, sky, greenery tend to surface first,
    // with vivid accents trailing. Stable tiebreak on Lab so the order
    // doesn't jitter across renders.
    return clusters.slice().sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight
      if (a.l !== b.l) return a.l - b.l
      return a.a - b.a
    })
  }, [mediaItems, scope, k])
}
