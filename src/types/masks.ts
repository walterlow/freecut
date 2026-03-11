/** Bezier mask vertex (normalized 0-1 relative to item bounds) */
export interface MaskVertex {
  position: [number, number];
  inHandle: [number, number];
  outHandle: [number, number];
}
