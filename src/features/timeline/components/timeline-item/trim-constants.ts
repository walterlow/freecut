export interface EdgeColors {
  edge: string;
  glow: string;
  fade: string;
}

export const CONSTRAINED_COLORS: EdgeColors = {
  edge: 'rgba(239, 68, 68, 0.9)',
  glow: '0 0 8px rgba(239, 68, 68, 0.5)',
  fade: 'rgba(239, 68, 68, 0.3)',
};

export const FREE_COLORS: EdgeColors = {
  edge: 'rgba(74, 222, 128, 0.9)',
  glow: '0 0 8px rgba(74, 222, 128, 0.5)',
  fade: 'rgba(74, 222, 128, 0.3)',
};

/** Describes which edges are actively being operated on and their constraint state */
export interface ActiveEdgeState {
  start: boolean;
  end: boolean;
  constrainedEdge: 'start' | 'end' | 'both' | null;
}
