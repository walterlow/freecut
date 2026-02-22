/**
 * Clamp a slip delta against source bounds.
 *
 * @param sourceStart - Current source start in source-native frames
 * @param sourceEnd - Current source end in source-native frames. When undefined,
 * the function short-circuits to 0 (no-op slip), so callers without explicit
 * source bounds will silently produce no slip.
 * @param sourceDuration - Total source duration in source-native frames. When
 * undefined, forward slipping is unconstrained (no upper bound clamp).
 * @param delta - Proposed slip delta in source-native frames
 */
export function computeClampedSlipDelta(
  sourceStart: number,
  sourceEnd: number | undefined,
  sourceDuration: number | undefined,
  delta: number,
): number {
  if (sourceEnd === undefined) return 0;

  let clamped = delta;

  // Clamp: sourceStart + delta >= 0
  if (sourceStart + clamped < 0) {
    clamped = -sourceStart;
  }

  // Clamp: sourceEnd + delta <= sourceDuration
  if (sourceDuration !== undefined && sourceEnd + clamped > sourceDuration) {
    clamped = sourceDuration - sourceEnd;
  }

  return clamped;
}
