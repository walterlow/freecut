import type { FreesoundAssetMetadata } from '@/types/studio-audio'
import type { FreesoundCueMatch } from '../services/freesound-studio-audio-service'

export type CinematicSoundLayerRole = 'body' | 'pre-motion' | 'texture' | 'tail'

export interface CinematicFreesoundLayer {
  asset: FreesoundAssetMetadata
  role: CinematicSoundLayerRole
  offsetSeconds: number
  gainDb: number
}

function uniqueAssets(match: FreesoundCueMatch): FreesoundAssetMetadata[] {
  const seen = new Set<number>()
  return [match.selected, ...match.alternatives].filter((asset) => {
    if (seen.has(asset.id)) return false
    seen.add(asset.id)
    return true
  })
}

export function planCinematicFreesoundLayers(match: FreesoundCueMatch): CinematicFreesoundLayer[] {
  const assets = uniqueAssets(match)
  const body = assets[0]
  if (!body) return []

  if (match.cue.role === 'impact' || match.cue.role === 'transition') {
    return [
      { asset: body, role: 'body', offsetSeconds: 0, gainDb: 0 },
      ...(assets[1]
        ? [{ asset: assets[1], role: 'pre-motion' as const, offsetSeconds: -0.2, gainDb: -5.5 }]
        : []),
      ...(assets[2]
        ? [{ asset: assets[2], role: 'tail' as const, offsetSeconds: 0.07, gainDb: -7 }]
        : []),
    ]
  }

  if (match.cue.role === 'foreground' && assets[1]) {
    return [
      { asset: body, role: 'body', offsetSeconds: 0, gainDb: 0 },
      { asset: assets[1], role: 'texture', offsetSeconds: 0.035, gainDb: -6 },
    ]
  }

  return [{ asset: body, role: 'body', offsetSeconds: 0, gainDb: 0 }]
}
