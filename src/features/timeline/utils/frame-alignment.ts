const FRAME_EPSILON = 1

export function areFramesAligned(leftEnd: number, rightStart: number): boolean {
  return Math.abs(leftEnd - rightStart) <= FRAME_EPSILON
}

/**
 * Check if two clips overlap (right clip starts before left clip ends).
 */
export function areFramesOverlapping(leftEnd: number, rightStart: number): boolean {
  return rightStart < leftEnd - FRAME_EPSILON
}
