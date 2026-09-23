import type { TFunction } from 'i18next'
import type { ItemKeyframes, Keyframe } from '@/types/keyframe'
import { getKeyframePropertyLabel } from '@/features/editor/deps/keyframes'

/** Translation function shared by the summary builders. */
type Translate = TFunction

/** Manual keyframes on the selected clip, summarised for the Applied rows. */
export interface ManualKeyframeSummary {
  properties: string[]
  keyframeCount: number
  firstFrame: number | null
}

/** One preset application (all keyframes sharing an applicationId). */
export interface KeyframeApplicationSummary {
  source: NonNullable<Keyframe['source']>
  properties: Set<string>
  keyframeCount: number
  firstFrame: number
}

/**
 * Groups every generated (preset-applied) keyframe of one clip by application,
 * so each preset application shows up as one removable row. Scalar lanes and
 * coupled vector lanes are both included; manual keyframes are ignored (they
 * carry no source).
 */
export function collectKeyframeApplications(
  keyframes: ItemKeyframes | null,
  t: Translate,
): KeyframeApplicationSummary[] {
  const applications = new Map<string, KeyframeApplicationSummary>()
  const add = (propertyLabel: string, frame: number, source: Keyframe['source']) => {
    if (!source) return
    const current = applications.get(source.applicationId) ?? {
      source,
      properties: new Set<string>(),
      keyframeCount: 0,
      firstFrame: frame,
    }
    current.properties.add(propertyLabel)
    current.keyframeCount += 1
    current.firstFrame = Math.min(current.firstFrame, frame)
    applications.set(source.applicationId, current)
  }
  for (const property of keyframes?.properties ?? []) {
    const label = getKeyframePropertyLabel(t, property.property)
    for (const keyframe of property.keyframes) add(label, keyframe.frame, keyframe.source)
  }
  for (const property of keyframes?.vectorProperties ?? []) {
    const label = t(`editor.animateStages.vectorProperties.${property.property}`)
    for (const keyframe of property.keyframes) add(label, keyframe.frame, keyframe.source)
  }
  return [...applications.values()]
}

/**
 * Summarises the clip's manual keyframes: which properties carry them, how many
 * there are and where the first one sits. Lanes without manual keyframes are
 * skipped so the row never lists an untouched property.
 */
export function summarizeManualKeyframes(
  keyframes: ItemKeyframes | null,
  t: Translate,
): ManualKeyframeSummary {
  const properties = new Set<string>()
  let keyframeCount = 0
  let firstFrame = Number.POSITIVE_INFINITY

  const collect = (label: string, lane: { keyframes: readonly { frame: number; source?: unknown }[] }) => {
    const manualKeyframes = lane.keyframes.filter((keyframe) => !keyframe.source)
    if (manualKeyframes.length === 0) return
    properties.add(label)
    keyframeCount += manualKeyframes.length
    for (const keyframe of manualKeyframes) firstFrame = Math.min(firstFrame, keyframe.frame)
  }

  for (const property of keyframes?.properties ?? []) {
    collect(getKeyframePropertyLabel(t, property.property), property)
  }
  for (const property of keyframes?.vectorProperties ?? []) {
    collect(t(`editor.animateStages.vectorProperties.${property.property}`), property)
  }

  return {
    properties: [...properties],
    keyframeCount,
    firstFrame: Number.isFinite(firstFrame) ? firstFrame : null,
  }
}
