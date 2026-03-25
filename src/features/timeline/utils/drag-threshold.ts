export function hasExceededDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold: number,
): boolean {
  return Math.abs(currentX - startX) > threshold || Math.abs(currentY - startY) > threshold;
}
