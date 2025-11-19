import type { TimelineTrack, TimelineItem } from '@/types/timeline';

export interface TimelineState {
  tracks: TimelineTrack[];
  items: TimelineItem[];
  fps: number;
  scrollPosition: number;
  snapEnabled: boolean;
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
  saveTimeline: (projectId: string) => Promise<void>;
  loadTimeline: (projectId: string) => Promise<void>;
  clearTimeline: () => void;
}
