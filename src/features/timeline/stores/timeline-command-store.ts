import { create } from 'zustand';
import type { TimelineCommand, CommandEntry, TimelineSnapshot } from './commands/types';
import { captureSnapshot, restoreSnapshot, snapshotsEqual } from './commands/snapshot';
import { useSettingsStore } from '@/features/timeline/deps/settings';
import { formatTimelineCommandLabel } from './commands/labels';

/**
 * Command store state.
 * Maintains undo/redo stacks and provides atomic history management.
 */
interface CommandStoreState {
  undoStack: CommandEntry[];
  redoStack: CommandEntry[];
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Command store actions.
 * The execute() function is the core API - it captures state before running an action.
 */
interface CommandStoreActions {
  /**
   * Execute a command with automatic undo support.
   * Captures a snapshot before running the action, enabling undo.
   *
   * @param command - Metadata about the command being executed
   * @param action - The function that performs the actual state changes
   * @returns The return value of the action function
   */
  execute: <T>(command: TimelineCommand, action: () => T) => T;

  /**
   * Undo the last command.
   * Restores the state from before the command was executed.
   */
  undo: () => void;

  /**
   * Redo a previously undone command.
   * Restores the state from after the command was executed.
   */
  redo: () => void;

  /**
   * Clear all history.
   * Called when loading a new project or resetting the timeline.
   */
  clearHistory: () => void;

  /**
   * Get the last command type (for debugging/UI).
   */
  getLastCommandType: () => string | null;

  /**
   * Get the next undo command label for UI affordances.
   */
  getUndoLabel: () => string | null;

  /**
   * Get the next redo command label for UI affordances.
   */
  getRedoLabel: () => string | null;

  /**
   * Add a pre-captured snapshot to the undo stack.
   * Used for drag operations where snapshot is captured at start and committed at end.
   */
  addUndoEntry: (command: TimelineCommand, beforeSnapshot: TimelineSnapshot) => void;
}

export const useTimelineCommandStore = create<CommandStoreState & CommandStoreActions>()(
  (set, get) => ({
    // State
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,

    // Execute a command
    execute: <T>(command: TimelineCommand, action: () => T): T => {
      const beforeSnapshot = captureSnapshot();

      // Execute the action
      const result = action();

      // Capture after state to check if anything changed
      const afterSnapshot = captureSnapshot();

      // Only add to history if state actually changed
      if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
        const maxHistory = useSettingsStore.getState().maxUndoHistory;
        set((state) => ({
          undoStack: [
            ...state.undoStack.slice(-(maxHistory - 1)),
            { command, beforeSnapshot, timestamp: Date.now() },
          ],
          redoStack: [], // Clear redo on new action
          canUndo: true,
          canRedo: false,
        }));
      }

      return result;
    },

    // Undo
    undo: () => {
      const { undoStack } = get();
      if (undoStack.length === 0) return;

      // Capture current state for redo
      const currentSnapshot = captureSnapshot();
      const entry = undoStack[undoStack.length - 1]!;

      // Restore previous state
      restoreSnapshot(entry.beforeSnapshot);

      set((state) => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          { command: entry.command, beforeSnapshot: currentSnapshot, timestamp: entry.timestamp },
        ],
        canUndo: state.undoStack.length > 1,
        canRedo: true,
      }));
    },

    // Redo
    redo: () => {
      const { redoStack } = get();
      if (redoStack.length === 0) return;

      // Capture current state for undo
      const currentSnapshot = captureSnapshot();
      const entry = redoStack[redoStack.length - 1]!;

      // Restore the "after" state (which is stored in beforeSnapshot after undo swapped it)
      restoreSnapshot(entry.beforeSnapshot);

      set((state) => ({
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [
          ...state.undoStack,
          { command: entry.command, beforeSnapshot: currentSnapshot, timestamp: entry.timestamp },
        ],
        canUndo: true,
        canRedo: state.redoStack.length > 1,
      }));
    },

    // Clear history
    clearHistory: () =>
      set({
        undoStack: [],
        redoStack: [],
        canUndo: false,
        canRedo: false,
      }),

    // Get last command type
    getLastCommandType: () => {
      const { undoStack } = get();
      if (undoStack.length === 0) return null;
      const entry = undoStack[undoStack.length - 1];
      return entry ? entry.command.type : null;
    },

    getUndoLabel: () => {
      const { undoStack } = get();
      if (undoStack.length === 0) return null;
      const entry = undoStack[undoStack.length - 1];
      return entry ? formatTimelineCommandLabel(entry.command) : null;
    },

    getRedoLabel: () => {
      const { redoStack } = get();
      if (redoStack.length === 0) return null;
      const entry = redoStack[redoStack.length - 1];
      return entry ? formatTimelineCommandLabel(entry.command) : null;
    },

    // Add pre-captured snapshot to undo stack (for drag operations)
    addUndoEntry: (command: TimelineCommand, beforeSnapshot: TimelineSnapshot) => {
      const afterSnapshot = captureSnapshot();
      
      // Only add to history if state actually changed
      if (!snapshotsEqual(beforeSnapshot, afterSnapshot)) {
        const maxHistory = useSettingsStore.getState().maxUndoHistory;
        set((state) => ({
          undoStack: [
            ...state.undoStack.slice(-(maxHistory - 1)),
            { command, beforeSnapshot, timestamp: Date.now() },
          ],
          redoStack: [], // Clear redo on new action
          canUndo: true,
          canRedo: false,
        }));
      }
    },
  })
);
