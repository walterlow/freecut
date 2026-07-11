import type {
  PixabayBrollAssetMetadata,
  PixabayBrollBeat,
  PixabayBrollSourceMetadata,
} from '@/types/studio-audio'

export interface PixabayBrollMatch {
  beat: PixabayBrollBeat
  selected: PixabayBrollAssetMetadata
  alternatives: PixabayBrollAssetMetadata[]
}

const API_ROOT =
  (import.meta.env.VITE_STUDIO_AUDIO_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8787/api/studio-audio'

async function readJson<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(value.error || `Pixabay request failed (${response.status})`)
  return value
}

export const pixabayBrollService = {
  async matchBeats(beats: PixabayBrollBeat[], signal?: AbortSignal): Promise<PixabayBrollMatch[]> {
    if (beats.length === 0) return []
    const response = await fetch(`${API_ROOT}/pixabay/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ beats }),
      signal,
    })
    const data = await readJson<{
      matches: Array<{
        beatId: string
        selected: PixabayBrollAssetMetadata
        alternatives: PixabayBrollAssetMetadata[]
      }>
    }>(response)
    const beatsById = new Map(beats.map((beat) => [beat.id, beat]))
    return data.matches.flatMap((match) => {
      const beat = beatsById.get(match.beatId)
      return beat ? [{ beat, selected: match.selected, alternatives: match.alternatives }] : []
    })
  },

  assetUrl(asset: PixabayBrollAssetMetadata): string {
    return `${API_ROOT}/pixabay/assets/${encodeURIComponent(asset.assetKey)}`
  },

  sourceMetadata(match: PixabayBrollMatch): PixabayBrollSourceMetadata {
    return {
      provider: 'pixabay',
      assetId: match.selected.id,
      assetKind: match.selected.kind,
      title: match.selected.title,
      creator: match.selected.creator,
      sourceUrl: match.selected.pageUrl,
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      retrievedAt: new Date().toISOString(),
      query: match.beat.query,
      sceneId: match.beat.id,
      variant: match.selected.variant,
      score: match.selected.score,
    }
  },
}
