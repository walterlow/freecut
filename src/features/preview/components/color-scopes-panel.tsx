import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { usePlaybackStore } from '@/shared/state/playback';

const SAMPLE_WIDTH = 192;
const SAMPLE_HEIGHT = 108;
const WAVEFORM_WIDTH = 256;
const WAVEFORM_HEIGHT = 128;
const VECTORSCOPE_SIZE = 160;

function drawWaveform(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D
): void {
  const { data, width, height } = imageData;
  const density = new Uint16Array(WAVEFORM_WIDTH * WAVEFORM_HEIGHT);
  let maxDensity = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const px = Math.floor((x / Math.max(1, width - 1)) * (WAVEFORM_WIDTH - 1));
      const py = WAVEFORM_HEIGHT - 1 - Math.floor(luma * (WAVEFORM_HEIGHT - 1));
      const di = py * WAVEFORM_WIDTH + px;
      const next = density[di] + 1;
      density[di] = next;
      if (next > maxDensity) maxDensity = next;
    }
  }

  const image = ctx.createImageData(WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  const out = image.data;
  const divisor = Math.max(1, maxDensity);

  for (let i = 0; i < density.length; i += 1) {
    const d = density[i] / divisor;
    if (d <= 0) continue;
    const outIdx = i * 4;
    const intensity = Math.min(255, Math.round(30 + d * 225));
    out[outIdx] = 40;
    out[outIdx + 1] = intensity;
    out[outIdx + 2] = 120;
    out[outIdx + 3] = Math.min(255, Math.round(70 + d * 185));
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, WAVEFORM_WIDTH, WAVEFORM_HEIGHT);
  ctx.putImageData(image, 0, 0);
}

function drawVectorscope(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D
): void {
  const { data, width, height } = imageData;
  const density = new Uint16Array(VECTORSCOPE_SIZE * VECTORSCOPE_SIZE);
  let maxDensity = 0;

  const center = Math.floor(VECTORSCOPE_SIZE / 2);
  const radius = center - 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;

      const yPrime = 0.299 * r + 0.587 * g + 0.114 * b;
      const u = (b - yPrime) * 0.492;
      const v = (r - yPrime) * 0.877;

      const px = Math.round(center + u * radius * 2);
      const py = Math.round(center - v * radius * 2);
      if (px < 0 || px >= VECTORSCOPE_SIZE || py < 0 || py >= VECTORSCOPE_SIZE) continue;

      const di = py * VECTORSCOPE_SIZE + px;
      const next = density[di] + 1;
      density[di] = next;
      if (next > maxDensity) maxDensity = next;
    }
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, VECTORSCOPE_SIZE, VECTORSCOPE_SIZE);

  const image = ctx.createImageData(VECTORSCOPE_SIZE, VECTORSCOPE_SIZE);
  const out = image.data;
  const divisor = Math.max(1, maxDensity);

  for (let i = 0; i < density.length; i += 1) {
    const d = density[i] / divisor;
    if (d <= 0) continue;
    const outIdx = i * 4;
    const intensity = Math.min(255, Math.round(50 + d * 205));
    out[outIdx] = 70;
    out[outIdx + 1] = intensity;
    out[outIdx + 2] = 255;
    out[outIdx + 3] = Math.min(255, Math.round(60 + d * 195));
  }

  ctx.putImageData(image, 0, 0);

  // Graticule (drawn after putImageData so it renders on top)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center, center, Math.floor(radius * 0.66), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(center, 0);
  ctx.lineTo(center, VECTORSCOPE_SIZE);
  ctx.moveTo(0, center);
  ctx.lineTo(VECTORSCOPE_SIZE, center);
  ctx.stroke();
}

interface ColorScopesPanelProps {
  open: boolean;
}

export const ColorScopesPanel = memo(function ColorScopesPanel({ open }: ColorScopesPanelProps) {
  const captureFrame = usePlaybackStore((s) => s.captureFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'live' | 'error'>('idle');

  const drawFromCapture = useCallback(async () => {
    if (!open || !captureFrame) return;
    const waveformCanvas = waveformCanvasRef.current;
    const vectorscopeCanvas = vectorscopeCanvasRef.current;
    if (!waveformCanvas || !vectorscopeCanvas) return;

    const waveformCtx = waveformCanvas.getContext('2d');
    const vectorscopeCtx = vectorscopeCanvas.getContext('2d');
    if (!waveformCtx || !vectorscopeCtx) return;

    try {
      const frameDataUrl = await captureFrame({
        width: SAMPLE_WIDTH,
        height: SAMPLE_HEIGHT,
        format: 'image/webp',
        quality: 0.85,
      });
      if (!frameDataUrl) {
        setStatus('idle');
        return;
      }

      const img = new Image();
      img.src = frameDataUrl;
      await img.decode();

      let sampleCanvas = sampleCanvasRef.current;
      if (!sampleCanvas) {
        sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = SAMPLE_WIDTH;
        sampleCanvas.height = SAMPLE_HEIGHT;
        sampleCanvasRef.current = sampleCanvas;
      }
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) return;

      sampleCtx.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      sampleCtx.drawImage(img, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const imageData = sampleCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

      drawWaveform(imageData, waveformCtx);
      drawVectorscope(imageData, vectorscopeCtx);
      setStatus('live');
    } catch {
      setStatus('error');
    }
  }, [captureFrame, open]);

  useEffect(() => {
    if (!open) return;
    if (isPlaying) return;
    void drawFromCapture();
  }, [open, isPlaying, currentFrame, previewFrame, drawFromCapture]);

  useEffect(() => {
    if (!open || !isPlaying) return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        await drawFromCapture();
        await new Promise((r) => setTimeout(r, 160));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isPlaying, drawFromCapture]);

  if (!open) return null;

  return (
    <div className="absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-2 pointer-events-none">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Scopes</div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Activity className={`w-3 h-3 ${status === 'live' ? 'text-emerald-500' : status === 'error' ? 'text-red-500' : ''}`} />
          {status === 'live' ? 'live' : status === 'error' ? 'err' : 'idle'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] mb-1 text-muted-foreground">Waveform</div>
          <canvas
            ref={waveformCanvasRef}
            width={WAVEFORM_WIDTH}
            height={WAVEFORM_HEIGHT}
            className="w-[220px] h-[110px] rounded border border-border/70 bg-black/80"
          />
        </div>
        <div>
          <div className="text-[10px] mb-1 text-muted-foreground">Vectorscope</div>
          <canvas
            ref={vectorscopeCanvasRef}
            width={VECTORSCOPE_SIZE}
            height={VECTORSCOPE_SIZE}
            className="w-[160px] h-[160px] rounded border border-border/70 bg-black/80"
          />
        </div>
      </div>
    </div>
  );
});

