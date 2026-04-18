/**
 * Cross-feature adapter — scene-browser accesses media-library state and
 * the shared source player through this barrel so the import graph stays
 * one-directional (feature-boundary rule in CLAUDE.md).
 */

export * from './media-library-contract';
export { useSourcePlayerStore } from '@/shared/state/source-player';
export { useEditorStore } from '@/app/state/editor';
export type { MediaMetadata } from '@/types/storage';
