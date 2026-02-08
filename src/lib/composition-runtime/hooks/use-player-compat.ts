/**
 * Composition compatibility layer for the custom player.
 *
 * These hooks provide a Composition-like API using the custom Clock-based player.
 * Export uses Canvas + WebCodecs (client-render-engine.ts), not Composition's renderer.
 */

import { useVideoConfig as useCustomVideoConfig } from '@/features/player/video-config-context';
import { useBridgedCurrentFrame, useBridgedIsPlaying } from '@/features/player/clock';

/**
 * Get video config (fps, width, height, durationInFrames) from the custom player context.
 */
export function useVideoConfig() {
  return useCustomVideoConfig();
}

/**
 * Get current frame from the custom player's Clock.
 */
export function useCurrentFrame() {
  return useBridgedCurrentFrame();
}

/**
 * Check if we're in rendering mode.
 * Always returns false since we use Canvas + WebCodecs for export, not Composition's renderer.
 */
export function useIsRendering(): boolean {
  return false;
}

/**
 * Get playing state from the custom player's Clock.
 */
export function useIsPlaying(): boolean {
  return useBridgedIsPlaying();
}
