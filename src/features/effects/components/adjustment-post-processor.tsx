/**
 * @deprecated UNUSED - Kept for reference only.
 * Halftone effects now use pure CSS approach in adjustment-wrapper.tsx and item-effect-wrapper.tsx.
 * The CSS approach avoids WebGL flickering issues during play/pause transitions.
 *
 * AdjustmentPostProcessor - Canvas-based post-processing for adjustment layers
 *
 * Captures the rendered composition and applies WebGL effects like halftone.
 * Uses a dual-layer approach:
 * 1. Children render normally in a container
 * 2. Canvas overlay captures and processes the content
 * 3. Processed result displayed on canvas, original hidden
 *
 * For video content, directly accesses video elements for efficient capture.
 * For mixed content, composites all visual elements to a source canvas.
 */

import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { useVideoConfig } from '@/lib/composition-runtime/hooks/use-player-compat';
import { adjustmentPostProcessingManager, type PostProcessingEffect } from '../utils/post-processing-pipeline';

// Default effect for when post-processing is disabled (values won't be used but prevent null checks)
const DEFAULT_EFFECT: PostProcessingEffect = {
  type: 'halftone',
  options: {
    dotSize: 8,
    spacing: 10,
    angle: 45,
    intensity: 1,
    backgroundColor: '#ffffff',
    dotColor: '#000000',
  },
};

interface AdjustmentPostProcessorProps {
  children: React.ReactNode;
  effect: PostProcessingEffect | null;
  enabled: boolean;
}

/**
 * AdjustmentPostProcessor wraps children and applies canvas-based effects.
 *
 * Architecture:
 * - Renders children in a container div
 * - Maintains a capture canvas (for compositing sources) and output canvas (for display)
 * - Captures video/image elements and composites them
 * - Applies WebGL post-processing to the composite
 * - Displays processed result on output canvas
 */
export const AdjustmentPostProcessor: React.FC<AdjustmentPostProcessorProps> = ({
  children,
  effect,
  enabled,
}) => {
  // Resolve effect with fallback to defaults (effect may be null when disabled)
  const resolvedEffect = effect ?? DEFAULT_EFFECT;

  const containerRef = useRef<HTMLDivElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pauseCooldownRef = useRef(false); // Skip capture briefly after video pauses

  // Track latest effect options via ref so RAF loop always uses current values
  // This fixes live preview during slider drag when video is paused
  const effectRef = useRef(resolvedEffect);
  effectRef.current = resolvedEffect;

  // Initialize to true when enabled to prevent flash on mount
  // Canvas may briefly be empty, but that's better than flashing children
  const [isProcessing, setIsProcessing] = useState(enabled);

  const { width, height } = useVideoConfig();

  // Initialize capture canvas
  useEffect(() => {
    if (!enabled) return;

    // Create offscreen capture canvas
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    captureCanvasRef.current.width = width;
    captureCanvasRef.current.height = height;
    captureCtxRef.current = captureCanvasRef.current.getContext('2d', {
      willReadFrequently: false,
    });

    // Set output canvas size
    if (outputCanvasRef.current) {
      outputCanvasRef.current.width = width;
      outputCanvasRef.current.height = height;
    }

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, width, height]);

  // Capture and process frame
  const captureAndProcess = useCallback(() => {
    if (!enabled || !containerRef.current || !outputCanvasRef.current) return;

    // Skip capture during pause cooldown to prevent flicker
    if (pauseCooldownRef.current) return;

    const captureCanvas = captureCanvasRef.current;
    const captureCtx = captureCtxRef.current;
    if (!captureCanvas || !captureCtx) return;

    // Clear capture canvas
    captureCtx.clearRect(0, 0, width, height);

    // Find all video and image elements in the container
    const videos = containerRef.current.querySelectorAll('video');
    const images = containerRef.current.querySelectorAll('img');
    const canvases = containerRef.current.querySelectorAll('canvas');

    let hasContent = false;

    // Draw videos to capture canvas
    videos.forEach((video) => {
      if (video.readyState >= 2) {
        try {
          // Get video's position relative to container
          const rect = video.getBoundingClientRect();
          const containerRect = containerRef.current!.getBoundingClientRect();

          const x = rect.left - containerRect.left;
          const y = rect.top - containerRect.top;
          const videoWidth = rect.width;
          const videoHeight = rect.height;

          // Scale to composition size
          const scaleX = width / containerRect.width;
          const scaleY = height / containerRect.height;

          captureCtx.drawImage(
            video,
            x * scaleX,
            y * scaleY,
            videoWidth * scaleX,
            videoHeight * scaleY
          );
          hasContent = true;
        } catch (e) {
          // Video might not be ready or cross-origin
        }
      }
    });

    // Draw images to capture canvas
    images.forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        try {
          const rect = img.getBoundingClientRect();
          const containerRect = containerRef.current!.getBoundingClientRect();

          const x = rect.left - containerRect.left;
          const y = rect.top - containerRect.top;
          const imgWidth = rect.width;
          const imgHeight = rect.height;

          const scaleX = width / containerRect.width;
          const scaleY = height / containerRect.height;

          captureCtx.drawImage(
            img,
            x * scaleX,
            y * scaleY,
            imgWidth * scaleX,
            imgHeight * scaleY
          );
          hasContent = true;
        } catch (e) {
          // Image might be cross-origin
        }
      }
    });

    // Draw existing canvases (e.g., per-clip halftone output)
    canvases.forEach((canvas) => {
      if (canvas !== outputCanvasRef.current && canvas.width > 0 && canvas.height > 0) {
        try {
          const rect = canvas.getBoundingClientRect();
          const containerRect = containerRef.current!.getBoundingClientRect();

          const x = rect.left - containerRect.left;
          const y = rect.top - containerRect.top;
          const canvasWidth = rect.width;
          const canvasHeight = rect.height;

          const scaleX = width / containerRect.width;
          const scaleY = height / containerRect.height;

          captureCtx.drawImage(
            canvas,
            x * scaleX,
            y * scaleY,
            canvasWidth * scaleX,
            canvasHeight * scaleY
          );
          hasContent = true;
        } catch (e) {
          // Canvas might be tainted
        }
      }
    });

    if (!hasContent) {
      // Don't reset isProcessing - keep showing previous canvas content
      // This prevents flash when video readyState temporarily drops on pause
      return;
    }

    // Apply post-processing - use effectRef.current for latest options during RAF loop
    // This ensures live preview updates work even when video is paused
    const pipeline = adjustmentPostProcessingManager.getPipeline(width, height);
    const processedCanvas = pipeline.process(captureCanvas, effectRef.current);

    if (processedCanvas && outputCanvasRef.current) {
      const outputCtx = outputCanvasRef.current.getContext('2d');
      if (outputCtx) {
        outputCtx.clearRect(0, 0, width, height);
        outputCtx.drawImage(processedCanvas, 0, 0);
        setIsProcessing(true);
      }
    }
  }, [enabled, width, height]);

  // Listen for video pause events - skip immediate captures then force refresh
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const handlePause = () => {
      // Skip captures briefly while video stabilizes, then force a fresh capture
      pauseCooldownRef.current = true;
      setTimeout(() => {
        pauseCooldownRef.current = false;
        // Force a fresh capture after video has stabilized at paused frame
        captureAndProcess();
      }, 100); // Wait ~6 frames for video to fully stabilize
    };

    // Use event delegation on container to catch all video pause events
    const container = containerRef.current;
    const handleContainerPause = (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        handlePause();
      }
    };
    container.addEventListener('pause', handleContainerPause, true);

    return () => {
      container.removeEventListener('pause', handleContainerPause, true);
    };
  }, [enabled, captureAndProcess]);

  // Start continuous capture loop - RAF handles frame updates, no need for frame dependency
  useLayoutEffect(() => {
    if (!enabled) {
      setIsProcessing(false);
      return;
    }

    // Use requestAnimationFrame for smooth updates
    const processFrame = () => {
      captureAndProcess();
      rafIdRef.current = requestAnimationFrame(processFrame);
    };

    // Initial capture
    captureAndProcess();

    // Start continuous capture loop for smooth playback
    rafIdRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [enabled, captureAndProcess]);

  // NOTE: No separate useEffect for effect option changes needed
  // The RAF loop reads from effectRef.current which always has latest values
  // Updates are picked up within ~16ms (one RAF frame)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Original content - visible when not processing, hidden when processing */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isProcessing ? 0 : 1,
          pointerEvents: isProcessing ? 'none' : 'auto',
        }}
      >
        {children}
      </div>

      {/* Processed output canvas - visible when processing */}
      <canvas
        ref={outputCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: isProcessing ? 1 : 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export default AdjustmentPostProcessor;
