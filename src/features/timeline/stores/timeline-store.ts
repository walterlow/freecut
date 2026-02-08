/**
 * Timeline Store
 *
 * This file re-exports from the facade store for backward compatibility.
 * The implementation has been split into domain-specific stores:
 *
 * - items-store.ts: Timeline items and tracks
 * - transitions-store.ts: Transitions between clips
 * - keyframes-store.ts: Animation keyframes
 * - markers-store.ts: Project markers and in/out points
 * - timeline-settings-store.ts: FPS, snap, scroll settings
 * - timeline-command-store.ts: Undo/redo command history
 *
 * For new code, prefer importing directly from domain stores or timeline-actions.
 */

// Main facade hook - maintains identical API to previous implementation
export { useTimelineStore } from './timeline-store-facade';

// Re-export all actions for direct use
export * from './timeline-actions';
