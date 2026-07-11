import type { StudioAudioCredit } from '@/types/studio-audio'
import type { TimelineItem } from '@/types/timeline'

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function collectStudioAudioCredits(
  items: TimelineItem[],
  projectId: string,
  fps: number,
): StudioAudioCredit[] {
  const credits = new Map<number, StudioAudioCredit>()
  for (const item of items) {
    const source = item.studioAudioSource
    if (!source) continue
    const existing = credits.get(source.soundId)
    const usedAt = Math.max(0, item.from / Math.max(1, fps))
    if (existing) {
      if (!existing.usedAtSeconds.some((value) => Math.abs(value - usedAt) < 0.01)) {
        existing.usedAtSeconds.push(usedAt)
      }
      if (source.sceneId && !existing.sceneNames.includes(source.sceneId)) {
        existing.sceneNames.push(source.sceneId)
      }
      continue
    }
    credits.set(source.soundId, {
      ...source,
      projectId,
      usedAtSeconds: [usedAt],
      sceneNames: source.sceneId ? [source.sceneId] : [],
    })
  }
  return [...credits.values()].sort(
    (left, right) => left.usedAtSeconds[0]! - right.usedAtSeconds[0]!,
  )
}

export function formatYouTubeStudioAudioCredits(credits: StudioAudioCredit[]): string {
  if (credits.length === 0) return 'Audio and sound-effect credits:\n\nNo attributed sounds.'
  return [
    'Audio and sound-effect credits:',
    '',
    ...credits.flatMap((credit) => [
      `"${credit.title}" by ${credit.creator}`,
      `Source: ${credit.sourceUrl}`,
      `Licence: ${credit.license} - ${credit.licenseUrl}`,
      `Used at: ${credit.usedAtSeconds.map(formatTimestamp).join(', ')}`,
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
}

export function downloadStudioAudioCredits(
  credits: StudioAudioCredit[],
  projectName: string,
): void {
  const blob = new Blob([formatYouTubeStudioAudioCredits(credits)], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${projectName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-audio-credits.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}
