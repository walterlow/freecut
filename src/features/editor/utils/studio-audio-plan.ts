import type { StudioAudioPlanEvent } from '@/types/studio-audio'
import type { AudiobookSfxCue } from './audiobook-sfx'

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'before',
  'could',
  'every',
  'from',
  'into',
  'just',
  'their',
  'there',
  'these',
  'they',
  'this',
  'through',
  'under',
  'where',
  'while',
  'with',
])

export function buildStudioAudioSearchKeywords(cue: AudiobookSfxCue): string[] {
  const sourceWords = `${cue.label} ${cue.sourceText}`
    .toLowerCase()
    .match(/[a-z][a-z'-]{2,}/g)
    ?.filter((word) => !STOP_WORDS.has(word))
  const roleTerms =
    cue.role === 'ambience'
      ? ['ambience', 'environment', 'room tone']
      : cue.role === 'foreground'
        ? ['foley', 'close', 'clean']
        : ['cinematic', 'impact', 'transition']
  return [...new Set([...(sourceWords ?? []).slice(0, 7), ...roleTerms])].slice(0, 10)
}

export function estimateStudioAudioCueConfidence(cue: AudiobookSfxCue): number {
  if (!cue.sourceText.trim()) return 0.65
  if (cue.role === 'foreground') return 0.92
  if (cue.role === 'ambience') return 0.88
  return 0.82
}

export function mapAudiobookCuesToStudioAudioPlan(cues: AudiobookSfxCue[]): StudioAudioPlanEvent[] {
  return cues.map((cue) => ({
    id: cue.id,
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    category: cue.role,
    searchKeywords: buildStudioAudioSearchKeywords(cue),
    emotionalEffect: cue.label,
    suggestedVolumeDb: cue.mixVolumeDb,
    fadeInSeconds: cue.role === 'ambience' ? 0.45 : 0.02,
    fadeOutSeconds: cue.role === 'ambience' ? 1.1 : 0.35,
    confidence: estimateStudioAudioCueConfidence(cue),
    explanation: cue.reason,
    sourceText: cue.sourceText,
  }))
}
