import type { TimelineTrack, TimelineItem } from '@/types/timeline';

export interface TimelineState {
  tracks: TimelineTrack[];
  items: TimelineItem[];
  fps: number;
  scrollPosition: number;
  snapEnabled: boolean;
  inPoint: number | null;
  outPoint: number | null;
  isDirty: boolean; // Track unsaved changes
}

export interface TimelineActions {
  setTracks: (tracks: TimelineTrack[]) => void;
  addItem: (item: TimelineItem) => void;
  updateItem: (id: string, updates: Partial<TimelineItem>) => void;
  removeItems: (ids: string[]) => void;
  toggleSnap: () => void;
  moveItem: (id: string, newFrom: number, newTrackId?: string) => void;
  moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void;
  trimItemStart: (id: string, trimAmount: number) => void;
  trimItemEnd: (id: string, trimAmount: number) => void;
  splitItem: (id: string, splitFrame: number) => void;
  rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void;
  setInPoint: (frame: number) => void;
  setOutPoint: (frame: number) => void;
  clearInOutPoints: () => void;
  saveTimeline: (projectId: string) => Promise<void>;
  loadTimeline: (projectId: string) => Promise<void>;
  clearTimeline: () => void;
  markDirty: () => void;
  markClean: () => void;
}
