/**
 * Utility for computing mixed values across multi-selection.
 * Used in property panels when multiple items are selected.
 */

type MixedValue<T> = T | 'mixed';

/**
 * Tolerance for comparing numeric values.
 * Values within this tolerance are considered equal.
 */
const NUMERIC_TOLERANCE = 0.01;

/**
 * Get a mixed value from an array of items.
 * Returns 'mixed' if values differ across items, otherwise returns the common value.
 *
 * @param items - Array of items to extract values from
 * @param getter - Function to extract the value from each item
 * @param defaultValue - Default value when property is undefined
 * @returns The common value or 'mixed' if values differ
 *
 * @example
 * ```ts
 * const volume = getMixedValue(
 *   audioItems,
 *   (item) => item.volume,
 *   0
 * );
 * // Returns number if all items have same volume, 'mixed' otherwise
 * ```
 */
export function getMixedValue<TItem, TValue>(
  items: TItem[],
  getter: (item: TItem) => TValue | undefined,
  defaultValue: TValue
): MixedValue<TValue> {
  if (items.length === 0) return defaultValue;

  const values = items.map((item) => getter(item) ?? defaultValue);
  const firstValue = values[0]!;

  const areEqual = values.every((v) => {
    // For numbers, use tolerance-based comparison
    if (typeof v === 'number' && typeof firstValue === 'number') {
      return Math.abs(v - firstValue) < NUMERIC_TOLERANCE;
    }
    // For other types, use strict equality
    return v === firstValue;
  });

  return areEqual ? firstValue : 'mixed';
}
