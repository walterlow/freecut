import type { AnimatableProperty, Keyframe } from '@/types/keyframe'

interface PreviewFrameGroupEntry {
  property: AnimatableProperty
  keyframe: Keyframe
}

interface PreviewGroupRow {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

interface PreviewGroupFrameGroup {
  frame: number
  keyframes: PreviewFrameGroupEntry[]
}

interface PreviewGroup {
  rows: PreviewGroupRow[]
  frameGroups: PreviewGroupFrameGroup[]
}

interface GetDisplayedGroupFrameGroupsArgs {
  group: PreviewGroup
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

function groupPreviewEntries(
  entries: Array<PreviewFrameGroupEntry & { frame: number }>,
): PreviewGroupFrameGroup[] {
  return entries.reduce<PreviewGroupFrameGroup[]>((groups, entry) => {
    const lastGroup = groups.at(-1)
    if (lastGroup && lastGroup.frame === entry.frame) {
      lastGroup.keyframes.push({ property: entry.property, keyframe: entry.keyframe })
    } else {
      groups.push({
        frame: entry.frame,
        keyframes: [{ property: entry.property, keyframe: entry.keyframe }],
      })
    }
    return groups
  }, [])
}

export function getDisplayedGroupFrameGroups({
  group,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: GetDisplayedGroupFrameGroupsArgs): PreviewGroupFrameGroup[] {
  if (!sheetPreviewFrames) {
    return group.frameGroups
  }

  const duplicatePreviewIdSet = sheetPreviewDuplicateKeyframeIds
    ? new Set(sheetPreviewDuplicateKeyframeIds)
    : null

  const previewEntries = group.rows
    .flatMap((row) =>
      row.keyframes.map((keyframe) => ({
        property: row.property,
        keyframe,
        frame: sheetPreviewFrames[keyframe.id] ?? keyframe.frame,
      })),
    )
    .filter((entry) => !duplicatePreviewIdSet || duplicatePreviewIdSet.has(entry.keyframe.id))
    .toSorted((a, b) => a.frame - b.frame)

  return groupPreviewEntries(previewEntries)
}
