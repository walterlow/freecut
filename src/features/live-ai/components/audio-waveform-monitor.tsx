import { useEffect, useRef, useCallback, memo } from 'react';

interface AudioWaveformMonitorProps {
  stream: MediaStream | null;
  height?: number;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BG_COLOR = 'hsl(var(--muted))';
const BAR_COLOR = 'hsl(var(--primary))';

/**
 * Real-time audio waveform visualizer using Web Audio API AnalyserNode.
 * Renders frequency bars from the webcam's audio track.
 */
export const AudioWaveformMonitor = memo(function AudioWaveformMonitor({
  stream,
  height = 60,
}: AudioWaveformMonitorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const { width, height: h } = canvas;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, h);

    const barCount = Math.floor(width / (BAR_WIDTH + BAR_GAP));
    const step = Math.max(1, Math.floor(bufferLength / barCount));

    ctx.fillStyle = BAR_COLOR;
    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i * step] ?? 0;
      const barHeight = (value / 255) * h;
      const x = i * (BAR_WIDTH + BAR_GAP);
      ctx.fillRect(x, h - barHeight, BAR_WIDTH, barHeight);
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      source.disconnect();
      audioCtx.close();
      analyserRef.current = null;
      audioCtxRef.current = null;
      sourceRef.current = null;
    };
  }, [stream, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={height}
      className="w-full rounded-md border border-border"
      style={{ height }}
    />
  );
});
