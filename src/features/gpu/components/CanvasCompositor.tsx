/**
 * CanvasCompositor Component
 *
 * GPU-accelerated canvas compositor that renders video frames through
 * the render backend. Integrates the media module with the GPU rendering
 * pipeline for frame-accurate video editing.
 *
 * Features:
 * - WebCodecs/FFmpeg hybrid decoding
 * - GPU texture import (zero-copy when possible)
 * - Multi-layer compositing
 * - Frame-accurate seeking
 */

import React, {
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useState,
  memo,
} from 'react';
import { useRenderBackend } from '../hooks/use-render-backend';
import { useMediaSource } from '../hooks/use-media-source';
import { useGPUVideoFrame, useGPUVideoFrameBatch } from '../hooks/use-gpu-video-frame';
import type { RenderBackend } from '../backend/types';
import type { ImportedTexture } from '../media';

// ============================================
// Types
// ============================================

export interface VideoLayer {
  /** Unique layer ID */
  id: string;
  /** Source URL (video file or blob URL) */
  src: string;
  /** Start frame on timeline */
  from: number;
  /** Duration in frames */
  durationInFrames: number;
  /** Source start frame (for trimmed clips) */
  sourceStart?: number;
  /** Playback speed multiplier */
  speed?: number;
  /** Z-index for layering */
  zIndex?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Transform properties */
  transform?: {
    x?: number;
    y?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  };
}

export interface CanvasCompositorProps {
  /** Video layers to composite */
  layers: VideoLayer[];
  /** Current frame number */
  currentFrame: number;
  /** Frames per second */
  fps: number;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Background color */
  backgroundColor?: string;
  /** Callback when frame is rendered */
  onFrameRendered?: (frame: number) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

// ============================================
// Single Layer Renderer (internal)
// ============================================

interface LayerRendererProps {
  layer: VideoLayer;
  currentFrame: number;
  fps: number;
  backend: RenderBackend;
  onTextureReady: (id: string, texture: ImportedTexture | null) => void;
}

const LayerRenderer = memo<LayerRendererProps>(
  ({ layer, currentFrame, fps, backend, onTextureReady }) => {
    const { source, isLoading, error } = useMediaSource(layer.src, {
      id: layer.id,
    });

    // Calculate the frame number in the source video
    const sourceFrameNumber = useMemo(() => {
      const localFrame = currentFrame - layer.from;
      if (localFrame < 0 || localFrame >= layer.durationInFrames) {
        return -1; // Not visible
      }

      const speed = layer.speed ?? 1;
      const sourceStart = layer.sourceStart ?? 0;
      return Math.floor(sourceStart + localFrame * speed);
    }, [currentFrame, layer.from, layer.durationInFrames, layer.speed, layer.sourceStart]);

    // Get GPU texture for this frame
    const { texture, isLoading: textureLoading } = useGPUVideoFrame(
      sourceFrameNumber >= 0 ? source : null,
      sourceFrameNumber,
      { backend, fps }
    );

    // Report texture to parent
    useEffect(() => {
      if (sourceFrameNumber >= 0) {
        onTextureReady(layer.id, texture);
      } else {
        onTextureReady(layer.id, null);
      }
    }, [layer.id, sourceFrameNumber, texture, onTextureReady]);

    // This component doesn't render anything visible
    return null;
  }
);

LayerRenderer.displayName = 'LayerRenderer';

// ============================================
// Canvas Compositor Component
// ============================================

/**
 * GPU-accelerated canvas compositor for video layers
 */
export const CanvasCompositor = memo<CanvasCompositorProps>(
  ({
    layers,
    currentFrame,
    fps,
    width,
    height,
    backgroundColor = '#000000',
    onFrameRendered,
    onError,
    className,
    style,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const texturesRef = useRef<Map<string, ImportedTexture | null>>(new Map());
    const [renderTrigger, setRenderTrigger] = useState(0);

    // Initialize render backend
    const { backend, isLoading: backendLoading, error: backendError } = useRenderBackend(
      canvasRef as React.RefObject<HTMLCanvasElement>,
      { preferredBackend: 'webgpu' }
    );

    // Report backend errors
    useEffect(() => {
      if (backendError) {
        onError?.(new Error(backendError));
      }
    }, [backendError, onError]);

    // Sort layers by z-index
    const sortedLayers = useMemo(
      () => [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
      [layers]
    );

    // Get visible layers at current frame
    const visibleLayers = useMemo(() => {
      return sortedLayers.filter((layer) => {
        const start = layer.from;
        const end = layer.from + layer.durationInFrames;
        return currentFrame >= start && currentFrame < end;
      });
    }, [sortedLayers, currentFrame]);

    // Texture ready callback
    const handleTextureReady = useCallback(
      (id: string, texture: ImportedTexture | null) => {
        texturesRef.current.set(id, texture);
        // Trigger re-render
        setRenderTrigger((t) => t + 1);
      },
      []
    );

    // Render frame to canvas
    useEffect(() => {
      if (!backend || backendLoading) return;

      try {
        backend.beginFrame();

        // Clear with background color
        // Note: Actual clearing depends on backend implementation

        // Render each visible layer
        for (const layer of visibleLayers) {
          const texture = texturesRef.current.get(layer.id);
          if (!texture) continue;

          // Apply transform
          const transform = layer.transform ?? {};
          const opacity = layer.opacity ?? 1;

          // Render texture to screen
          // This uses the backend's renderToScreen method
          // with transform and opacity applied
          backend.renderToScreen(texture.handle, {
            transform: {
              x: transform.x ?? 0,
              y: transform.y ?? 0,
              scaleX: transform.scaleX ?? 1,
              scaleY: transform.scaleY ?? 1,
              rotation: transform.rotation ?? 0,
            },
            opacity,
          });
        }

        backend.endFrame();

        onFrameRendered?.(currentFrame);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Render failed');
        onError?.(error);
      }
    }, [
      backend,
      backendLoading,
      visibleLayers,
      currentFrame,
      renderTrigger,
      onFrameRendered,
      onError,
    ]);

    return (
      <div
        className={className}
        style={{
          position: 'relative',
          width,
          height,
          backgroundColor,
          ...style,
        }}
      >
        {/* Canvas for GPU rendering */}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />

        {/* Layer renderers (invisible, just manage textures) */}
        {backend &&
          visibleLayers.map((layer) => (
            <LayerRenderer
              key={layer.id}
              layer={layer}
              currentFrame={currentFrame}
              fps={fps}
              backend={backend}
              onTextureReady={handleTextureReady}
            />
          ))}

        {/* Loading indicator */}
        {backendLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ color: 'white' }}>Initializing GPU...</span>
          </div>
        )}

        {/* Error indicator */}
        {backendError && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.8)',
            }}
          >
            <span style={{ color: '#ff4444' }}>GPU Error: {backendError}</span>
          </div>
        )}
      </div>
    );
  }
);

CanvasCompositor.displayName = 'CanvasCompositor';

export default CanvasCompositor;
