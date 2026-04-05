import { usePlaybackStore } from './store';
import { getResolvedPlaybackFrame } from './frame-resolution';

/**
 * Subscribe to the frame that preview-adjacent UI should follow.
 */
export function useResolvedPlaybackFrame(): number {
  return usePlaybackStore((state) => getResolvedPlaybackFrame(state));
}
