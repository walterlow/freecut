import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ItemKeyframes } from '@/types/keyframe';
import type { SubComposition } from '../compositions-store';

/**
 * Snapshot of all timeline state for undo/redo.
 * This captures the complete state that can be restored.
 * Excludes ephemeral state (for example isDirty) that shouldn't be in history.
 */
export interface TimelineSnapshot {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  transitions: Transition[];
  keyframes: ItemKeyframes[];
  markers: ProjectMarker[];
  compositions: SubComposition[];
  inPoint: number | null;
  outPoint: number | null;
  fps: number;
  scrollPosition: number;
  snapEnabled: boolean;
  currentFrame: number;
}

/**
 * Base command interface.
 * Commands are metadata about what action was performed.
 * The actual undo/redo uses snapshots, not command-specific logic.
 */
export interface TimelineCommand {
  type: string;
  payload?: Record<string, unknown>;
}

/**
 * Entry in the undo/redo history stack.
 * Stores the command metadata and the state snapshot from before the command was executed.
 */
export interface CommandEntry {
  command: TimelineCommand;
  beforeSnapshot: TimelineSnapshot;
  timestamp: number;
}
