/**
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
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { adjustmentPostProcessingManager, type PostProcessingEffect } from '../utils/post-processing-pipeline';

interface AdjustmentPostProcessorProps {
  children: React.ReactNode;
  effect: PostProcessingEffect;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const frame = useCurrentFrame();
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
      setIsProcessing(false);
      return;
    }

    // Apply post-processing
    const pipeline = adjustmentPostProcessingManager.getPipeline(width, height);
    const processedCanvas = pipeline.process(captureCanvas, effect);

    if (processedCanvas && outputCanvasRef.current) {
      const outputCtx = outputCanvasRef.current.getContext('2d');
      if (outputCtx) {
        outputCtx.clearRect(0, 0, width, height);
        outputCtx.drawImage(processedCanvas, 0, 0);
        setIsProcessing(true);
      }
    }
  }, [enabled, width, height, effect]);

  // Process on every frame change
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
  }, [enabled, captureAndProcess, frame]);

  // Re-process when effect options change
  useEffect(() => {
    if (enabled) {
      captureAndProcess();
    }
  }, [effect, enabled, captureAndProcess]);

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
