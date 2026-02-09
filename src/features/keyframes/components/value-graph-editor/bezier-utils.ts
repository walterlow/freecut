export function updateBezierFromHandle(
  currentConfig: { x1: number; y1: number; x2: number; y2: number },
  handleType: 'in' | 'out',
  newX: number,
  newY: number
): { x1: number; y1: number; x2: number; y2: number } {
  if (handleType === 'out') {
    return { ...currentConfig, x1: newX, y1: newY };
  }

  return { ...currentConfig, x2: newX, y2: newY };
}
