import React, { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import { useCurrentFrame, useVideoConfig, useRemotionEnvironment, OffthreadVideo, Img, interpolate } from 'remotion';
import { HalftoneRenderer, type HalftoneGLOptions } from '../utils/halftone-shader';
import { renderHalftone } from '../utils/halftone-algorithm';

interface HalftoneWrapperProps {
  children: React.ReactNode;
  options: HalftoneGLOptions;
  enabled: boolean;
  mediaSrc?: string;
  itemType: string;
  /** Frames to trim from start of video (for in/out point export) */
  trimBefore?: number;
  /** Playback rate for speed adjustments */
  playbackRate?: number;
  /** Whether audio should be muted (passed through to video during render) */
  muted?: boolean;
  /** Volume in dB for audio (0 = unity gain) */
  volume?: number;
  /** Audio fade in duration in seconds */
  audioFadeIn?: number;
  /** Audio fade out duration in seconds */
  audioFadeOut?: number;
  /** Duration of the item in frames (needed for fade calculations) */
  durationInFrames?: number;
}

/**
 * HalftoneWrapper applies a halftone dot pattern effect to video/image content.
 *
 * Uses a hybrid rendering approach for best performance and compatibility:
 * - Preview mode: WebGL shaders for real-time GPU-accelerated rendering
 * - Render mode: Canvas 2D for reliable server-side rendering
 *
 * For video, uses Remotion's OffthreadVideo with onVideoFrame callback:
 * - During preview: receives HTMLVideoElement, rendered with WebGL
 * - During render: receives HTMLImageElement (exact frame), rendered with Canvas 2D
 */
export const HalftoneWrapper: React.FC<HalftoneWrapperProps> = ({
  children,
  options,
  enabled,
  mediaSrc,
  itemType,
  trimBefore,
  playbackRate = 1,
  muted = false,
  volume = 0,
  audioFadeIn = 0,
  audioFadeOut = 0,
  durationInFrames = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<HalftoneRenderer | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Cache the video element to avoid DOM query issues during React reconciliation
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const env = useRemotionEnvironment();

  // Determine if we're in preview mode (Player/Studio) or rendering
  const isPreview = env.isPlayer || env.isStudio;

  // Calculate audio volume with fades (same logic as VideoContent in item.tsx)
  const audioVolume = React.useMemo(() => {
    if (muted) return 0;

    // Calculate fade multiplier
    const fadeInFrames = Math.min(audioFadeIn * fps, durationInFrames);
    const fadeOutFrames = Math.min(audioFadeOut * fps, durationInFrames);

    let fadeMultiplier = 1;
    const hasFadeIn = fadeInFrames > 0;
    const hasFadeOut = fadeOutFrames > 0;

    if (hasFadeIn || hasFadeOut) {
      const fadeOutStart = durationInFrames - fadeOutFrames;

      if (hasFadeIn && hasFadeOut) {
        if (fadeInFrames >= fadeOutStart) {
          // Overlapping fades
          const midPoint = durationInFrames / 2;
          const peakVolume = Math.min(1, midPoint / Math.max(fadeInFrames, 1));
          fadeMultiplier = interpolate(
            frame,
            [0, midPoint, durationInFrames],
            [0, peakVolume, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        } else {
          fadeMultiplier = interpolate(
            frame,
            [0, fadeInFrames, fadeOutStart, durationInFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          );
        }
      } else if (hasFadeIn) {
        fadeMultiplier = interpolate(
          frame,
          [0, fadeInFrames],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      } else {
        fadeMultiplier = interpolate(
          frame,
          [fadeOutStart, durationInFrames],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
      }
    }

    // Convert dB to linear (0 dB = unity gain = 1.0)
    const linearVolume = Math.pow(10, volume / 20);
    return Math.max(0, Math.min(1, linearVolume * fadeMultiplier));
  }, [muted, volume, audioFadeIn, audioFadeOut, durationInFrames, frame, fps]);

  // State for media loading
  const [rendererReady, setRendererReady] = useState(false);
  const [imageReady, setImageReady] = useState(false);

  // Initialize WebGL renderer (preview mode only)
  useLayoutEffect(() => {
    if (!enabled || !canvasRef.current || !isPreview) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const renderer = new HalftoneRenderer(canvas);
    rendererRef.current = renderer;

    if (renderer.isReady()) {
      setRendererReady(true);
    } else {
      console.error('[HalftoneWrapper] Failed to initialize WebGL renderer');
    }

    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, [enabled, width, height, isPreview]);

  // Initialize source canvas for render mode
  useLayoutEffect(() => {
    if (!enabled || isPreview) return;

    // Create offscreen canvas for source frame capture
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    sourceCanvasRef.current = canvas;

    return () => {
      sourceCanvasRef.current = null;
    };
  }, [enabled, width, height, isPreview]);

  // Load image for processing (images only) - preview mode only
  // In render mode, we use Remotion's Img component with onLoad callback
  useEffect(() => {
    // Only use new Image() in preview mode - blob URLs work in the browser
    if (!enabled || !mediaSrc || itemType !== 'image' || !isPreview) {
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageRef.current = img;
      setImageReady(true);
    };

    img.onerror = (e) => {
      console.error('[HalftoneWrapper] Failed to load image:', mediaSrc, e);
      setImageReady(false);
    };

    img.src = mediaSrc;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [mediaSrc, itemType, enabled, isPreview]);

  // Handle image load callback for render mode (used by Remotion's Img component)
  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    imageRef.current = img;
    setImageReady(true);
  }, []);

  // Handle video frame callback from OffthreadVideo
  const handleVideoFrame = useCallback((frameSource: CanvasImageSource) => {
    const outputCanvas = canvasRef.current;
    if (!outputCanvas) return;

    if (isPreview) {
      // Preview mode: use WebGL for fast rendering
      if (rendererRef.current && rendererReady) {
        rendererRef.current.render(frameSource as HTMLVideoElement | HTMLImageElement, options);
      }
    } else {
      // Render mode: use Canvas 2D for reliable rendering
      const sourceCanvas = sourceCanvasRef.current;
      if (!sourceCanvas) return;

      const ctx = sourceCanvas.getContext('2d');
      if (!ctx) return;

      // Draw the frame to source canvas
      ctx.drawImage(frameSource, 0, 0, width, height);

      // Apply halftone effect
      renderHalftone(sourceCanvas, outputCanvas, options);
    }
  }, [options, width, height, isPreview, rendererReady]);

  // Render halftone effect for images and preview video from DOM
  useLayoutEffect(() => {
    if (!enabled) return;

    const outputCanvas = canvasRef.current;
    if (!outputCanvas) return;

    // Handle images
    if (itemType === 'image' && imageRef.current && imageReady) {
      if (isPreview && rendererRef.current && rendererReady) {
        // Preview: WebGL
        rendererRef.current.render(imageRef.current, options);
      } else if (!isPreview) {
        // Render: Canvas 2D
        const sourceCanvas = sourceCanvasRef.current;
        if (!sourceCanvas) return;

        const ctx = sourceCanvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(imageRef.current, 0, 0, width, height);
        renderHalftone(sourceCanvas, outputCanvas, options);
      }
    }

    // Handle video in preview mode - capture from DOM video element
    if (itemType === 'video' && isPreview && contentRef.current && rendererRef.current && rendererReady) {
      // Try to get video element from cache first, fall back to DOM query
      let videoElement = videoElementRef.current;

      // Verify cached element is still valid (connected to DOM and has same parent)
      if (!videoElement || !videoElement.isConnected || !contentRef.current.contains(videoElement)) {
        videoElement = contentRef.current.querySelector('video');
        videoElementRef.current = videoElement;
      }

      if (videoElement && videoElement.readyState >= 2) {
        rendererRef.current.render(videoElement, options);
      }
      // If video not ready, canvas retains previous frame (no clear() call in WebGL renderer)
    }
  }, [frame, enabled, options, itemType, imageReady, rendererReady, isPreview, width, height]);

  // If not enabled, just render children
  if (!enabled) {
    return <>{children}</>;
  }

  // If no media source, fall back to children
  if (!mediaSrc) {
    return <>{children}</>;
  }

  // For video
  if (itemType === 'video') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Original children for audio playback - only in preview mode */}
        {/* In render mode, children may contain blob URLs that don't work on server */}
        {isPreview && (
          <div
            ref={contentRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              pointerEvents: 'none',
            }}
          >
            {children}
          </div>
        )}

        {/* OffthreadVideo for frame extraction and audio during render - only needed in render mode */}
        {!isPreview && mediaSrc && (
          <OffthreadVideo
            src={mediaSrc}
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none',
            }}
            volume={audioVolume}
            trimBefore={trimBefore && trimBefore > 0 ? trimBefore : undefined}
            playbackRate={playbackRate}
            onVideoFrame={handleVideoFrame}
            onError={(err) => {
              // Log but don't crash - Remotion will retry failed frames
              console.warn('[HalftoneWrapper] Frame extraction warning:', err.message);
            }}
          />
        )}

        {/* Output canvas for halftone rendering */}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
        />
      </div>
    );
  }

  // For images
  // Debug: this should only be reached for image items
  if (!isPreview) {
    console.log('[HalftoneWrapper] IMAGE RENDER MODE - itemType:', itemType, 'mediaSrc:', mediaSrc?.substring(0, 60));
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Original children - only render in preview mode for fallback display */}
      {/* In render mode, we use our own Img component to avoid blob URL issues */}
      {isPreview && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      )}

      {/* Remotion Img for render mode - loads image from server URL and triggers onLoad */}
      {!isPreview && mediaSrc && (
        <Img
          src={mediaSrc}
          onLoad={handleImageLoad}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Output canvas for halftone rendering */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
};

export default HalftoneWrapper;
