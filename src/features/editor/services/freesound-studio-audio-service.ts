import type {
  FreesoundAssetMetadata,
  StudioAudioLicensePolicy,
  StudioAudioSourceMetadata,
} from '@/types/studio-audio'
import type { AudiobookSfxCue } from '../utils/audiobook-sfx'
import {
  buildStudioAudioSearchKeywords,
  estimateStudioAudioCueConfidence,
} from '../utils/studio-audio-plan'

export interface FreesoundProviderStatus {
  provider: 'freesound'
  searchConfigured: boolean
  oauthConfigured: boolean
  oauthConnected: boolean
  callbackUrl: string
  callbackMode: 'manual-code' | 'application-callback'
  pixabayConfigured: boolean
}

export interface FreesoundCueMatch {
  cue: AudiobookSfxCue
  selected: FreesoundAssetMetadata
  alternatives: FreesoundAssetMetadata[]
}

const API_ROOT =
  (import.meta.env.VITE_STUDIO_AUDIO_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8787/api/studio-audio'

async function readJson<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as T & {
    error?: string
  }
  if (!response.ok)
    throw new Error(value.error || `Studio Audio request failed (${response.status})`)
  return value
}

function getAudioExtension(contentType: string): string {
  if (contentType.includes('wav')) return 'wav'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('flac')) return 'flac'
  if (contentType.includes('aiff')) return 'aiff'
  return 'mp3'
}

export const freesoundStudioAudioService = {
  async getStatus(): Promise<FreesoundProviderStatus> {
    return readJson(await fetch(`${API_ROOT}/status`))
  },

  async getAuthorization(): Promise<{
    authorizeUrl: string
    callbackUrl: string
    state: string
  }> {
    return readJson(await fetch(`${API_ROOT}/freesound/authorize`))
  },

  async exchangeCode(code: string): Promise<void> {
    await readJson(
      await fetch(`${API_ROOT}/freesound/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    )
  },

  async matchCues(
    cues: AudiobookSfxCue[],
    policy: StudioAudioLicensePolicy,
    quality: 'standard' | 'cinematic' = 'standard',
    signal?: AbortSignal,
  ): Promise<FreesoundCueMatch[]> {
    if (cues.length === 0) return []
    const response = await fetch(`${API_ROOT}/freesound/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        policy,
        quality,
        cues: cues.map((cue) => ({
          id: cue.id,
          query: buildStudioAudioSearchKeywords(cue).join(' '),
          targetDuration: Math.max(1, cue.endSeconds - cue.startSeconds),
        })),
      }),
      signal,
    })
    const data = await readJson<{
      matches: Array<{
        cueId: string
        selected: FreesoundAssetMetadata | null
        alternatives: FreesoundAssetMetadata[]
      }>
    }>(response)
    const cueById = new Map(cues.map((cue) => [cue.id, cue]))
    return data.matches.flatMap((match) => {
      const cue = cueById.get(match.cueId)
      return cue && match.selected
        ? [{ cue, selected: match.selected, alternatives: match.alternatives }]
        : []
    })
  },

  async downloadMatch(
    match: FreesoundCueMatch,
    preferOriginal: boolean,
    signal?: AbortSignal,
  ): Promise<{ file: File; blob: Blob; sourceKind: 'preview' | 'original' }> {
    const response = await fetch(
      `${API_ROOT}/freesound/sounds/${match.selected.id}/asset?original=${preferOriginal ? '1' : '0'}`,
      { signal },
    )
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      throw new Error(data.error || `Could not download Freesound ${match.selected.id}`)
    }
    const blob = await response.blob()
    const extension = getAudioExtension(blob.type)
    const safeName = match.selected.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80)
    return {
      blob,
      file: new File([blob], `${safeName || `freesound-${match.selected.id}`}.${extension}`, {
        type: blob.type || 'audio/mpeg',
      }),
      sourceKind: preferOriginal ? 'original' : 'preview',
    }
  },

  buildSourceMetadata(
    match: FreesoundCueMatch,
    sourceKind: 'preview' | 'original',
  ): StudioAudioSourceMetadata {
    return {
      provider: 'freesound',
      soundId: match.selected.id,
      title: match.selected.name,
      creator: match.selected.username,
      sourceUrl: match.selected.soundUrl,
      license: match.selected.license,
      licenseUrl: match.selected.licenseUrl,
      licenseCode: match.selected.licenseCode,
      retrievedAt: new Date().toISOString(),
      sourceKind,
      reason: match.cue.reason,
      confidence: estimateStudioAudioCueConfidence(match.cue),
      approval: match.selected.licenseCode === 'cc0' ? 'approved' : 'recommended',
      locked: false,
      sceneId: match.cue.id,
    }
  },
}
