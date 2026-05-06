let activeTimelineDropPreviewOwner: string | null = null
const timelineDropPreviewOwnerClearers = new Map<string, () => void>()

export function registerTimelineDropPreviewOwner(ownerId: string, clear: () => void): () => void {
  timelineDropPreviewOwnerClearers.set(ownerId, clear)

  return () => {
    if (timelineDropPreviewOwnerClearers.get(ownerId) === clear) {
      timelineDropPreviewOwnerClearers.delete(ownerId)
    }
  }
}

export function claimTimelineDropPreviewOwner(ownerId: string): boolean {
  if (activeTimelineDropPreviewOwner === ownerId) {
    return false
  }

  const previousOwner = activeTimelineDropPreviewOwner
  activeTimelineDropPreviewOwner = ownerId
  if (previousOwner) {
    timelineDropPreviewOwnerClearers.get(previousOwner)?.()
  }
  return true
}

export function isTimelineDropPreviewOwner(ownerId: string): boolean {
  return activeTimelineDropPreviewOwner === ownerId
}

export function releaseTimelineDropPreviewOwner(ownerId: string): void {
  if (activeTimelineDropPreviewOwner === ownerId) {
    activeTimelineDropPreviewOwner = null
  }
}

export function clearActiveTimelineDropPreviewOwner(): void {
  const owner = activeTimelineDropPreviewOwner
  activeTimelineDropPreviewOwner = null
  if (owner) {
    timelineDropPreviewOwnerClearers.get(owner)?.()
  }
}

export function clearAllTimelineDropPreviewOwners(): void {
  activeTimelineDropPreviewOwner = null
  for (const clear of timelineDropPreviewOwnerClearers.values()) {
    clear()
  }
}
