/** Maps itemSize (1=smallest, 5=largest) to CSS grid column classes */
export const GRID_COLS_BY_SIZE: Record<number, string> = {
  1: 'grid-cols-5 gap-1',
  2: 'grid-cols-4 gap-1.5',
  3: 'grid-cols-3 gap-2',
  4: 'grid-cols-2 gap-3',
  5: 'grid-cols-1 gap-3',
};
