type MarqueeSelectionMode = 'replace' | 'add' | 'toggle'

export function resolveMarqueeSelection(
  mode: MarqueeSelectionMode,
  baseSelection: Set<string>,
  hitIds: Set<string>,
): Set<string> {
  if (mode === 'replace') {
    return hitIds
  }

  if (mode === 'add') {
    return new Set([...baseSelection, ...hitIds])
  }

  const nextSelection = new Set(baseSelection)
  for (const id of hitIds) {
    if (nextSelection.has(id)) {
      nextSelection.delete(id)
    } else {
      nextSelection.add(id)
    }
  }
  return nextSelection
}
