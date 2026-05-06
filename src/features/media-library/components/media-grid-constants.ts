/**
 * Maps itemSize (1=smallest, 5=largest) to a minimum card width in pixels.
 * CSS grid auto-fill with minmax() keeps card size stable — the column count
 * adjusts when the sidebar resizes instead of cards stretching/shrinking.
 */
export const GRID_MIN_SIZE_PX: Record<number, number> = {
  1: 80,
  2: 110,
  3: 140,
  4: 200,
  5: 280,
}

/** Maps itemSize to gap class */
export const GRID_GAP_BY_SIZE: Record<number, string> = {
  1: 'gap-1',
  2: 'gap-1.5',
  3: 'gap-2',
  4: 'gap-3',
  5: 'gap-3',
}
