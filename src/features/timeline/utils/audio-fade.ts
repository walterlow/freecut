export type AudioFadeHandle = 'in' | 'out'

export function getAudioFadePixels(
  fadeSeconds: number | undefined,
  fps: number,
  frameToPixels: (frame: number) => number,
  maxWidth: number,
): number {
  if (!fadeSeconds || fadeSeconds <= 0) return 0
  return Math.max(0, Math.min(maxWidth, frameToPixels(fadeSeconds * fps)))
}

export function getAudioFadeRatio(
  fadeSeconds: number | undefined,
  fps: number,
  maxDurationFrames: number,
): number {
  if (!fadeSeconds || fadeSeconds <= 0 || maxDurationFrames <= 0) return 0
  return Math.max(0, Math.min(1, (fadeSeconds * fps) / maxDurationFrames))
}

export function getAudioFadeSecondsFromOffset(params: {
  handle: AudioFadeHandle
  clipWidthPixels: number
  pointerOffsetPixels: number
  fps: number
  maxDurationFrames: number
}): number {
  if (params.clipWidthPixels <= 0 || params.maxDurationFrames <= 0) {
    return 0
  }

  const offsetPixels = Math.max(0, Math.min(params.clipWidthPixels, params.pointerOffsetPixels))
  const fadePixels = params.handle === 'in' ? offsetPixels : params.clipWidthPixels - offsetPixels
  const fadeRatio = fadePixels / params.clipWidthPixels
  const fadeFrames = Math.max(
    0,
    Math.min(params.maxDurationFrames, Math.round(fadeRatio * params.maxDurationFrames)),
  )
  if (params.fps <= 0) return 0
  return fadeFrames / params.fps
}

export function getAudioFadeHandleLeft(params: {
  handle: AudioFadeHandle
  clipWidthPixels: number
  fadePixels: number
}): number {
  const x = params.handle === 'in' ? params.fadePixels : params.clipWidthPixels - params.fadePixels
  return Math.max(0, Math.min(params.clipWidthPixels, x))
}
