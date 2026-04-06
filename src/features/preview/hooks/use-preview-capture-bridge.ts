import { useEffect, type MutableRefObject } from 'react';
import type { CaptureOptions } from '@/shared/state/playback';

interface UsePreviewCaptureBridgeParams {
  captureCurrentFrame: (options?: CaptureOptions) => Promise<string | null>;
  captureCurrentFrameImageData: (options?: CaptureOptions) => Promise<ImageData | null>;
  captureCanvasSource: () => Promise<OffscreenCanvas | HTMLCanvasElement | null>;
  setCaptureFrame: (fn: ((options?: CaptureOptions) => Promise<string | null>) | null) => void;
  setCaptureFrameImageData: (fn: ((options?: CaptureOptions) => Promise<ImageData | null>) | null) => void;
  setCaptureCanvasSource: (fn: (() => Promise<OffscreenCanvas | HTMLCanvasElement | null>) | null) => void;
  setDisplayedFrame: (frame: number | null) => void;
  captureInFlightRef: MutableRefObject<Promise<string | null> | null>;
  captureImageDataInFlightRef: MutableRefObject<Promise<ImageData | null> | null>;
  captureScaleCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
}

export function usePreviewCaptureBridge({
  captureCurrentFrame,
  captureCurrentFrameImageData,
  captureCanvasSource,
  setCaptureFrame,
  setCaptureFrameImageData,
  setCaptureCanvasSource,
  setDisplayedFrame,
  captureInFlightRef,
  captureImageDataInFlightRef,
  captureScaleCanvasRef,
}: UsePreviewCaptureBridgeParams) {
  useEffect(() => {
    setCaptureFrame(captureCurrentFrame);
    setCaptureFrameImageData(captureCurrentFrameImageData);
    setCaptureCanvasSource(captureCanvasSource);
    return () => {
      setCaptureFrame(null);
      setCaptureFrameImageData(null);
      setCaptureCanvasSource(null);
      setDisplayedFrame(null);
      captureInFlightRef.current = null;
      captureImageDataInFlightRef.current = null;
      captureScaleCanvasRef.current = null;
    };
  }, [
    captureCanvasSource,
    captureCurrentFrame,
    captureCurrentFrameImageData,
    captureImageDataInFlightRef,
    captureInFlightRef,
    captureScaleCanvasRef,
    setCaptureCanvasSource,
    setCaptureFrame,
    setCaptureFrameImageData,
    setDisplayedFrame,
  ]);
}
