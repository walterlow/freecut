import type { Transition } from '@/types/transition'
import type { AudioItem, CompositionItem, TimelineItem, VideoItem } from '@/types/timeline'

export interface ManagedLinkedAudioTransitionPair {
  leftAudio: AudioItem
  rightAudio: AudioItem
}

export interface ManagedLinkedAudioTransition {
  transition: Transition
  leftAudio: AudioItem
  rightAudio: AudioItem
}

function isVisualTimelineItem(item: TimelineItem): item is VideoItem | CompositionItem {
  return item.type === 'video' || item.type === 'composition'
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (!anchor.originId || anchor.originId !== candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames
}

function isLinkedCompanion(
  anchor: TimelineItem,
  candidate: TimelineItem,
  targetType: TimelineItem['type'],
): boolean {
  if (candidate.id === anchor.id || candidate.type !== targetType) return false

  if (anchor.linkedGroupId && candidate.linkedGroupId) {
    return anchor.linkedGroupId === candidate.linkedGroupId
  }

  return isLegacyLinkedPair(anchor, candidate)
}

export function isCompositionAudioItem(
  item: TimelineItem,
): item is AudioItem & { compositionId: string } {
  return (
    item.type === 'audio' && typeof item.compositionId === 'string' && item.compositionId.length > 0
  )
}

export function getLinkedCompositionAudioCompanion(
  items: TimelineItem[],
  anchor: CompositionItem,
): (AudioItem & { compositionId: string }) | null {
  if (!anchor.linkedGroupId) return null

  return (
    (items.find(
      (candidate) =>
        candidate.id !== anchor.id &&
        isCompositionAudioItem(candidate) &&
        candidate.linkedGroupId === anchor.linkedGroupId &&
        candidate.compositionId === anchor.compositionId,
    ) as (AudioItem & { compositionId: string }) | undefined) ?? null
  )
}

export function getLinkedCompositionVisualCompanion(
  items: TimelineItem[],
  anchor: AudioItem & { compositionId: string },
): CompositionItem | null {
  if (!anchor.linkedGroupId) return null

  return (
    (items.find(
      (candidate) =>
        candidate.type === 'composition' &&
        candidate.linkedGroupId === anchor.linkedGroupId &&
        candidate.compositionId === anchor.compositionId,
    ) as CompositionItem | undefined) ?? null
  )
}

export function getLinkedAudioCompanion(
  items: TimelineItem[],
  anchor: TimelineItem,
): AudioItem | null {
  if (anchor.type === 'composition') {
    return getLinkedCompositionAudioCompanion(items, anchor)
  }
  if (anchor.type !== 'video') return null
  return (
    (items.find((candidate) => isLinkedCompanion(anchor, candidate, 'audio')) as
      | AudioItem
      | undefined) ?? null
  )
}

export function getLinkedVideoCompanion(
  items: TimelineItem[],
  anchor: TimelineItem,
): VideoItem | CompositionItem | null {
  if (!isCompositionAudioItem(anchor) && anchor.type !== 'audio') return null
  if (isCompositionAudioItem(anchor)) {
    return getLinkedCompositionVisualCompanion(items, anchor)
  }
  return (
    (items.find((candidate) => isLinkedCompanion(anchor, candidate, 'video')) as
      | VideoItem
      | undefined) ?? null
  )
}

export function isSynchronizedLinkedAudio(
  videoClip: VideoItem | CompositionItem,
  audioClip: AudioItem,
): boolean {
  return (
    audioClip.from === videoClip.from && audioClip.durationInFrames === videoClip.durationInFrames
  )
}

export function getManagedLinkedAudioTransitionPair(
  items: TimelineItem[],
  leftClip: TimelineItem,
  rightClip: TimelineItem,
): ManagedLinkedAudioTransitionPair | null {
  if (!isVisualTimelineItem(leftClip) || !isVisualTimelineItem(rightClip)) {
    return null
  }

  const leftAudio = getLinkedAudioCompanion(items, leftClip)
  const rightAudio = getLinkedAudioCompanion(items, rightClip)
  if (!leftAudio || !rightAudio) {
    return null
  }

  if (leftAudio.trackId !== rightAudio.trackId) {
    return null
  }

  if (
    !isSynchronizedLinkedAudio(leftClip, leftAudio) ||
    !isSynchronizedLinkedAudio(rightClip, rightAudio)
  ) {
    return null
  }

  return { leftAudio, rightAudio }
}

export function getManagedLinkedAudioTransitions(
  items: TimelineItem[],
  transitions: Transition[],
): ManagedLinkedAudioTransition[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const managed: ManagedLinkedAudioTransition[] = []

  for (const transition of transitions) {
    const leftClip = itemById.get(transition.leftClipId)
    const rightClip = itemById.get(transition.rightClipId)
    if (!leftClip || !rightClip) continue

    const pair = getManagedLinkedAudioTransitionPair(items, leftClip, rightClip)
    if (!pair) continue

    managed.push({
      transition,
      leftAudio: pair.leftAudio,
      rightAudio: pair.rightAudio,
    })
  }

  return managed
}

export function hasLinkedAudioCompanion(items: TimelineItem[], anchor: TimelineItem): boolean {
  return getLinkedAudioCompanion(items, anchor) !== null
}

export function hasLinkedVideoCompanion(items: TimelineItem[], anchor: TimelineItem): boolean {
  return getLinkedVideoCompanion(items, anchor) !== null
}

export function getLinkedVideoIdsWithAudio(items: TimelineItem[]): Set<string> {
  const linkedVideoIds = new Set<string>()

  for (const item of items) {
    if (item.type === 'video' && hasLinkedAudioCompanion(items, item)) {
      linkedVideoIds.add(item.id)
    }
  }

  return linkedVideoIds
}
