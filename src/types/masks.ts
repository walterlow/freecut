/** Bezier mask vertex (normalized 0-1 relative to item bounds) */
export interface MaskVertex {
  position: [number, number];
  inHandle: [number, number];
  outHandle: [number, number];
}

/** Mask compositing mode */
export type MaskMode = 'add' | 'subtract' | 'intersect';

/** A single bezier mask path on a timeline item */
export interface ClipMask {
  id: string;
  vertices: MaskVertex[];
  mode: MaskMode;
  opacity: number;
  feather: number;
  inverted: boolean;
  enabled: boolean;
}
