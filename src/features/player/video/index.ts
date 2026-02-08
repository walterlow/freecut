/**
 * Video System - Multi-track video management
 *
 * This module provides components for managing multiple video
 * elements in a multi-track timeline:
 *
 * - VideoElement: Individual video with frame-accurate seeking
 * - VideoTrackManager: Orchestrates multiple videos
 * - useVideoFrame: requestVideoFrameCallback hook
 *
 * Example usage:
 *
 * ```tsx
 * <VideoTrackManager
 *   items={videoItems}
 *   currentFrame={frame}
 *   fps={30}
 *   isPlaying={playing}
 * />
 * ```
 */

// Types
export type {
  VideoItemData,
  VideoElementState,
  VideoSeekOptions,
  VideoFrameMetadata,
  VideoFrameCallback,
  VideoElementProps,
  VideoTrackManagerProps,
  VideoTrackState,
  PooledVideoElement,
  VideoPoolConfig,
} from './types';

// VideoElement component
export {
  VideoElement,
  type VideoElementHandle,
} from './VideoElement';

// VideoTrackManager component
export {
  VideoTrackManager,
  useVideoTrackState,
} from './VideoTrackManager';

// Video frame hooks
export {
  useVideoFrame,
  useCurrentVideoFrame,
  useVideoTimeSync,
  isVideoFrameCallbackSupported,
  requestSingleFrame,
  seekToTimeAccurate,
} from './use-video-frame';

// Native video layer (alternative to Composition-based rendering)
export { NativeVideoLayer } from './NativeVideoLayer';

// Video Source Pool - Efficient element reuse by source URL
export {
  VideoSourcePool,
  SourceController,
  getGlobalVideoSourcePool,
  disposeGlobalVideoSourcePool,
  type SourceMetadata,
  type ElementAssignment,
} from './VideoSourcePool';

// Pooled Video Layer - React component using source pool
export {
  PooledVideoLayer,
  usePoolStats,
  type PooledVideoLayerProps,
} from './PooledVideoLayer';

// Video Source Pool Context - React context for pool access
export {
  VideoSourcePoolProvider,
  useVideoSourcePool,
  type VideoSourcePoolProviderProps,
} from './VideoSourcePoolContext';
