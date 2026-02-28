export interface SourcePlayerMethods {
  toggle: () => void;
  seek: (frame: number) => void;
  frameBack: (frames: number) => void;
  frameForward: (frames: number) => void;
  getDurationInFrames: () => number;
}

export interface SourcePlayerState {
  hoveredPanel: 'source' | null;
  playerMethods: SourcePlayerMethods | null;
  currentMediaId: string | null;
  currentSourceFrame: number;
  inPoint: number | null;
  outPoint: number | null;
  pendingSeekFrame: number | null;
  setHoveredPanel: (panel: 'source' | null) => void;
  setPlayerMethods: (methods: SourcePlayerMethods | null) => void;
  setCurrentMediaId: (id: string | null) => void;
  setCurrentSourceFrame: (frame: number) => void;
  setInPoint: (frame: number | null) => void;
  setOutPoint: (frame: number | null) => void;
  clearInOutPoints: () => void;
  setPendingSeekFrame: (frame: number | null) => void;
}
