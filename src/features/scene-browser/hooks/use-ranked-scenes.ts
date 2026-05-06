import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/shared/logging/logger'
import { clipProvider, embeddingsProvider } from '../deps/analysis'
import { useMediaLibraryStore } from '../deps/media-library'
import { useSettingsStore } from '../deps/settings'
import { useSceneBrowserStore } from '../stores/scene-browser-store'
import {
  getEmbeddingsSnapshot,
  getImageEmbeddingsSnapshot,
  getPalettesSnapshot,
} from '../utils/embeddings-cache'
import { parseColorQuery } from '../utils/color-boost'
import { rankScenes, type RankableScene, type ScoredScene } from '../utils/rank'
import { semanticRank } from '../utils/semantic-rank'

const log = createLogger('SceneBrowser:RankedScenes')

export interface RankedScenesResult {
  scenes: ScoredScene[]
  totalScenes: number
  totalClips: number
  clipsWithCaptions: number
  /**
   * Filenames of media currently being Analyzed-with-AI (and therefore
   * excluded from the scene list above). Exposed so the panel can surface
   * a "re-analyzing" indicator while the old entries are hidden and the
   * new ones haven't landed yet.
   */
  reanalyzingMedia: Array<{ id: string; fileName: string }>
  /**
   * Whether the active search mode produced the shown ranking. Semantic
   * mode falls back to keyword while the query embedding is in flight —
   * the panel can use this to show a subtle "embedding…" indicator.
   */
  activeMode: 'keyword' | 'semantic'
  /**
   * True when a non-empty query is being ranked — toggles per-row score
   * chrome so browsing without a query doesn't look cluttered with 0%
   * badges on every scene.
   */
  isQuerying: boolean
  /**
   * Count of scenes (not clips) whose text embedding is currently loaded
   * in memory, vs. the total visible scene count. Gives the status-bar
   * something concrete to say while the background indexer is still
   * filling things in.
   */
  sceneTextIndexed: number
  /** Same, for CLIP image embeddings. */
  sceneImageIndexed: number
  /**
   * True while we're waiting on the query's semantic text embedding —
   * old scenes still render via keyword fallback, but the panel can show
   * a subtle "embedding query…" pill so the delay isn't mysterious.
   */
  queryTextEmbedding: 'idle' | 'embedding' | 'ready'
  /** Same, for the CLIP text-encoder half of the query. */
  queryImageEmbedding: 'idle' | 'embedding' | 'ready'
}

/**
 * Build the ranked scene list for the Scene Browser. The hook owns all
 * joining between media metadata and caption records so components can
 * treat each row as a self-contained record (filename, timestamp, thumb path).
 */
export function useRankedScenes(): RankedScenesResult {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const taggingMediaIds = useMediaLibraryStore((s) => s.taggingMediaIds)
  const query = useSceneBrowserStore((s) => s.query)
  const scope = useSceneBrowserStore((s) => s.scope)
  const sortMode = useSceneBrowserStore((s) => s.sortMode)
  const reference = useSceneBrowserStore((s) => s.reference)
  const captionSearchMode = useSettingsStore((s) => s.captionSearchMode)
  const colorQuery = useMemo(() => parseColorQuery(query), [query])

  // Embed the query with both text models when semantic mode is active.
  // Keeping each in a separate state slot (rather than a Suspense promise
  // or sync read) means typing stays fluid — old scenes remain visible
  // while the new embedding is in flight.
  const [queryEmbedding, setQueryEmbedding] = useState<Float32Array | null>(null)
  const [queryImageEmbedding, setQueryImageEmbedding] = useState<Float32Array | null>(null)
  const [queryTextState, setQueryTextState] = useState<'idle' | 'embedding' | 'ready'>('idle')
  const [queryImageState, setQueryImageState] = useState<'idle' | 'embedding' | 'ready'>('idle')

  useEffect(() => {
    if (captionSearchMode !== 'semantic' || query.trim().length === 0) {
      setQueryEmbedding(null)
      setQueryTextState('idle')
      return
    }
    if (colorQuery.paletteOnly) {
      setQueryEmbedding(new Float32Array(0))
      setQueryTextState('ready')
      return
    }
    let cancelled = false
    setQueryTextState('embedding')
    void embeddingsProvider
      .embed(query.trim())
      .then((vector) => {
        if (cancelled) return
        setQueryEmbedding(vector)
        setQueryTextState('ready')
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('Query text embedding failed — falling back to keyword', { query, error })
          setQueryEmbedding(null)
          setQueryTextState('idle')
        }
      })
    return () => {
      cancelled = true
    }
  }, [captionSearchMode, query, colorQuery.paletteOnly])

  // CLIP text-encoder embedding for the visual side. Loaded independently
  // so a slow CLIP download doesn't block text-side ranking — scenes can
  // be shown via text-only cosine until the CLIP query vector lands.
  useEffect(() => {
    if (captionSearchMode !== 'semantic' || query.trim().length === 0 || colorQuery.paletteOnly) {
      setQueryImageEmbedding(null)
      setQueryImageState('idle')
      return
    }
    let cancelled = false
    setQueryImageState('embedding')
    // Use the ensembled path so a one-word query ("fighting") gets
    // wrapped in natural-sentence templates before embedding — CLIP is
    // badly behaved on bare tokens and the averaged vector materially
    // reduces false positives like "a tower matches fighting".
    void clipProvider
      .embedQueryForImages(query.trim())
      .then((vector) => {
        if (cancelled) return
        if (vector) {
          setQueryImageEmbedding(vector)
          setQueryImageState('ready')
        } else {
          setQueryImageState('idle')
        }
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('CLIP query embedding failed — skipping visual ranking', { query, error })
          setQueryImageEmbedding(null)
          setQueryImageState('idle')
        }
      })
    return () => {
      cancelled = true
    }
  }, [captionSearchMode, query, colorQuery.paletteOnly])

  return useMemo<RankedScenesResult>(() => {
    const allScenes: RankableScene[] = []
    const reanalyzingMedia: Array<{ id: string; fileName: string }> = []
    let clipsWithCaptions = 0

    for (const media of mediaItems) {
      if (scope && media.id !== scope) continue
      // Hide entries for media that's actively being Analyzed-with-AI —
      // the old captions are about to be replaced, and surfacing them
      // alongside "re-analyzing" state would be misleading.
      if (taggingMediaIds.has(media.id)) {
        if (media.aiCaptions && media.aiCaptions.length > 0) {
          reanalyzingMedia.push({ id: media.id, fileName: media.fileName })
        }
        continue
      }
      const captions = media.aiCaptions
      if (!captions || captions.length === 0) continue
      clipsWithCaptions += 1
      captions.forEach((caption, captionIndex) => {
        allScenes.push({
          id: `${media.id}:${captionIndex}`,
          mediaId: media.id,
          mediaFileName: media.fileName,
          timeSec: caption.timeSec,
          text: caption.text,
          thumbRelPath: caption.thumbRelPath,
          palette: caption.palette,
        })
      })
    }

    const isSemanticActive =
      captionSearchMode === 'semantic' && query.trim().length > 0 && queryEmbedding !== null

    const textEmbeddings = getEmbeddingsSnapshot()
    const imageEmbeddings = getImageEmbeddingsSnapshot()
    const paletteSnapshot = getPalettesSnapshot()

    // A reference palette forces semantic-lane ranking (palette-only
    // scoring inside semanticRank). The query stays visible in the input
    // but is ignored until the reference is cleared.
    let ranked
    if (reference) {
      ranked = semanticRank(new Float32Array(0), allScenes, textEmbeddings, {
        palettes: paletteSnapshot,
        referencePalette: reference.palette,
      })
    } else if (isSemanticActive) {
      ranked = semanticRank(queryEmbedding!, allScenes, textEmbeddings, {
        queryImageEmbedding,
        imageEmbeddings,
        query,
        palettes: paletteSnapshot,
      })
    } else {
      ranked = rankScenes(query, allScenes)
    }

    // Coverage stats over the scenes the user can currently see, not
    // over the whole library — keeps the "indexed" counter honest when
    // scoped to a single media.
    let sceneTextIndexed = 0
    let sceneImageIndexed = 0
    for (const scene of allScenes) {
      if (textEmbeddings.has(scene.id)) sceneTextIndexed += 1
      if (imageEmbeddings.has(scene.id)) sceneImageIndexed += 1
    }

    const hasRankingSignal = query.trim().length > 0 || !!reference
    if (!hasRankingSignal || sortMode === 'time' || sortMode === 'name') {
      ranked.sort((a, b) => {
        if (a.mediaFileName !== b.mediaFileName) {
          return a.mediaFileName.localeCompare(b.mediaFileName)
        }
        return a.timeSec - b.timeSec
      })
    }
    // relevance sort is the default output of rankScenes / semanticRank.

    return {
      scenes: ranked,
      totalScenes: allScenes.length,
      totalClips: mediaItems.length,
      clipsWithCaptions,
      reanalyzingMedia,
      activeMode: isSemanticActive || reference ? 'semantic' : 'keyword',
      isQuerying: hasRankingSignal,
      sceneTextIndexed,
      sceneImageIndexed,
      queryTextEmbedding: queryTextState,
      queryImageEmbedding: queryImageState,
    }
  }, [
    mediaItems,
    taggingMediaIds,
    query,
    scope,
    sortMode,
    captionSearchMode,
    queryEmbedding,
    queryImageEmbedding,
    queryTextState,
    queryImageState,
    reference,
  ])
}
