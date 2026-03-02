import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { usePlaybackStore } from '@/shared/state/playback';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';

const SAMPLE_WIDTH_PAUSED = 384;
const SAMPLE_HEIGHT_PAUSED = 216;
const SAMPLE_WIDTH_PLAYING = 256;
const SAMPLE_HEIGHT_PLAYING = 144;
const WAVEFORM_WIDTH = 512;
const WAVEFORM_HEIGHT = 256;
const VECTORSCOPE_SIZE = 256;
const MAX_SCOPE_WIDTH = 1920;
const MAX_SCOPE_HEIGHT = 1080;
const MAX_VECTORSCOPE_SIZE = 1024;
const COLOR_MATRIX_STORAGE_KEY = 'timeline:scopes:colorMatrix';
const RANGE_MODE_STORAGE_KEY = 'timeline:scopes:rangeMode';
const LIVE_UPDATE_INTERVAL_MS = 220;

type ScopeColorMatrix = 'bt709' | 'bt601';
type ScopeRangeMode = 'full' | 'legal';

interface MatrixCoefficients {
  kr: number;
  kb: number;
}

function getMatrixCoefficients(matrix: ScopeColorMatrix): MatrixCoefficients {
  if (matrix === 'bt601') {
    return { kr: 0.299, kb: 0.114 };
  }
  return { kr: 0.2126, kb: 0.0722 };
}

function loadColorMatrix(): ScopeColorMatrix {
  try {
    const value = localStorage.getItem(COLOR_MATRIX_STORAGE_KEY);
    if (value === 'bt601' || value === 'bt709') {
      return value;
    }
  } catch {
    // ignore localStorage read errors
  }
  return 'bt709';
}

function loadRangeMode(): ScopeRangeMode {
  try {
    const value = localStorage.getItem(RANGE_MODE_STORAGE_KEY);
    if (value === 'full' || value === 'legal') {
      return value;
    }
  } catch {
    // ignore localStorage read errors
  }
  return 'full';
}

function normalizeRange(value: number, rangeMode: ScopeRangeMode): number {
  if (rangeMode === 'legal') {
    const legalMin = 16 / 255;
    const legalMax = 235 / 255;
    const legalSpan = legalMax - legalMin;
    return Math.max(0, Math.min(1, (value - legalMin) / legalSpan));
  }
  return Math.max(0, Math.min(1, value));
}

function drawIreGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const levels = [0, 25, 50, 75, 100];
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

  for (const level of levels) {
    const y = Math.round(height - 1 - (level / 100) * (height - 1));
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(level), 4, Math.max(10, y - 2));
  }
  ctx.restore();
}

function drawWaveform(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix,
  rangeMode: ScopeRangeMode,
  scopeWidth: number,
  scopeHeight: number
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const density = new Uint16Array(scopeWidth * scopeHeight);
  let maxDensity = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;
      const luma = normalizeRange(kr * r + kg * g + kb * b, rangeMode);

      const px = Math.floor((x / Math.max(1, width - 1)) * (scopeWidth - 1));
      const py = scopeHeight - 1 - Math.floor(luma * (scopeHeight - 1));
      const di = py * scopeWidth + px;
      const next = (density[di] ?? 0) + 1;
      density[di] = next;
      if (next > maxDensity) maxDensity = next;
    }
  }

  const image = ctx.createImageData(scopeWidth, scopeHeight);
  const out = image.data;
  const logDivisor = Math.log1p(Math.max(1, maxDensity));

  for (let i = 0; i < density.length; i += 1) {
    const bucket = density[i] ?? 0;
    if (bucket <= 0) continue;
    // Log normalization keeps sparse traces visible instead of near-black.
    const d = Math.log1p(bucket) / logDivisor;
    if (d <= 0) continue;
    const outIdx = i * 4;
    const intensity = Math.min(255, Math.round(65 + d * 190));
    out[outIdx] = 40;
    out[outIdx + 1] = intensity;
    out[outIdx + 2] = 120;
    out[outIdx + 3] = Math.min(255, Math.round(95 + d * 160));
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, scopeWidth, scopeHeight);
  ctx.putImageData(image, 0, 0);
  drawIreGrid(ctx, scopeWidth, scopeHeight);
}

function drawParade(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D,
  rangeMode: ScopeRangeMode,
  scopeWidth: number,
  scopeHeight: number
): void {
  const { data, width, height } = imageData;
  const density = new Uint16Array(scopeWidth * scopeHeight);
  let maxDensity = 0;
  const sectionWidth = Math.floor(scopeWidth / 3);
  const channelColors: Array<[number, number, number]> = [
    [255, 80, 80],
    [60, 255, 120],
    [90, 130, 255],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const channels = [
        (data[idx] ?? 0) / 255,
        (data[idx + 1] ?? 0) / 255,
        (data[idx + 2] ?? 0) / 255,
      ];
      const localX = Math.floor((x / Math.max(1, width - 1)) * (sectionWidth - 1));

      for (let c = 0; c < 3; c += 1) {
        const value = normalizeRange(channels[c] ?? 0, rangeMode);
        const px = c * sectionWidth + localX;
        const py = scopeHeight - 1 - Math.floor(value * (scopeHeight - 1));
        const di = py * scopeWidth + px;
        const next = (density[di] ?? 0) + 1;
        density[di] = next;
        if (next > maxDensity) maxDensity = next;
      }
    }
  }

  const image = ctx.createImageData(scopeWidth, scopeHeight);
  const out = image.data;
  const logDivisor = Math.log1p(Math.max(1, maxDensity));

  for (let y = 0; y < scopeHeight; y += 1) {
    for (let x = 0; x < scopeWidth; x += 1) {
      const i = y * scopeWidth + x;
      const bucket = density[i] ?? 0;
      if (bucket <= 0) continue;

      const d = Math.log1p(bucket) / logDivisor;
      const channel = Math.min(2, Math.floor(x / Math.max(1, sectionWidth)));
      const color = channelColors[channel] ?? [180, 180, 180];
      const outIdx = i * 4;
      out[outIdx] = Math.min(255, Math.round((color[0] ?? 180) * (0.25 + 0.75 * d)));
      out[outIdx + 1] = Math.min(255, Math.round((color[1] ?? 180) * (0.25 + 0.75 * d)));
      out[outIdx + 2] = Math.min(255, Math.round((color[2] ?? 180) * (0.25 + 0.75 * d)));
      out[outIdx + 3] = Math.min(255, Math.round(85 + d * 160));
    }
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, scopeWidth, scopeHeight);
  ctx.putImageData(image, 0, 0);
  drawIreGrid(ctx, scopeWidth, scopeHeight);

  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1;
  for (let n = 1; n < 3; n += 1) {
    const x = n * sectionWidth;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, scopeHeight);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText('R', 8, 12);
  ctx.fillText('G', sectionWidth + 8, 12);
  ctx.fillText('B', sectionWidth * 2 + 8, 12);
  ctx.restore();
}

function drawHistogram(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix,
  rangeMode: ScopeRangeMode,
  scopeWidth: number,
  scopeHeight: number
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const bins = new Uint32Array(256);
  let maxBin = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;
      const luma = normalizeRange(kr * r + kg * g + kb * b, rangeMode);
      const bin = Math.max(0, Math.min(255, Math.round(luma * 255)));
      const next = (bins[bin] ?? 0) + 1;
      bins[bin] = next;
      if (next > maxBin) maxBin = next;
    }
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, scopeWidth, scopeHeight);
  drawIreGrid(ctx, scopeWidth, scopeHeight);

  const logDivisor = Math.log1p(Math.max(1, maxBin));
  for (let i = 0; i < 256; i += 1) {
    const bucket = bins[i] ?? 0;
    if (bucket <= 0) continue;
    const strength = Math.log1p(bucket) / logDivisor;
    const x = Math.round((i / 255) * (scopeWidth - 1));
    const barHeight = Math.max(1, Math.round(strength * (scopeHeight - 1)));
    ctx.fillStyle = `rgba(116, 232, 195, ${0.35 + strength * 0.65})`;
    ctx.fillRect(x, scopeHeight - barHeight, Math.max(1, Math.round(scopeWidth / 256)), barHeight);
  }
}

function drawVectorscope(
  imageData: ImageData,
  ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix,
  scopeSize: number
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const density = new Uint32Array(scopeSize * scopeSize);
  let maxDensity = 0;

  const center = Math.floor(scopeSize / 2);
  const radius = center - 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;

      // Cb/Cr from Y'CbCr matrix coefficients.
      const yPrime = kr * r + kg * g + kb * b;
      const cb = (b - yPrime) / (2 * (1 - kb));
      const cr = (r - yPrime) / (2 * (1 - kr));

      const px = Math.round(center + cb * radius * 2);
      const py = Math.round(center - cr * radius * 2);
      if (px < 0 || px >= scopeSize || py < 0 || py >= scopeSize) continue;

      const di = py * scopeSize + px;
      const next = (density[di] ?? 0) + 1;
      density[di] = next;
      if (next > maxDensity) maxDensity = next;
    }
  }

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, scopeSize, scopeSize);

  const image = ctx.createImageData(scopeSize, scopeSize);
  const out = image.data;
  const logDivisor = Math.log1p(Math.max(1, maxDensity));

  for (let i = 0; i < density.length; i += 1) {
    const bucket = density[i] ?? 0;
    if (bucket <= 0) continue;
    const d = Math.log1p(bucket) / logDivisor;
    if (d <= 0) continue;
    const outIdx = i * 4;
    const intensity = Math.min(255, Math.round(70 + d * 185));
    out[outIdx] = 70;
    out[outIdx + 1] = intensity;
    out[outIdx + 2] = 255;
    out[outIdx + 3] = Math.min(255, Math.round(90 + d * 165));
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
  ctx.lineTo(center, scopeSize);
  ctx.moveTo(0, center);
  ctx.lineTo(scopeSize, center);
  ctx.stroke();
}

function ensureCanvasSize(
  canvas: HTMLCanvasElement,
  fallbackWidth: number,
  fallbackHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(
    2,
    Math.min(maxWidth, Math.round(rect.width || fallbackWidth))
  );
  const height = Math.max(
    2,
    Math.min(maxHeight, Math.round(rect.height || fallbackHeight))
  );

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width, height };
}

interface ColorScopesViewProps {
  open: boolean;
  embedded?: boolean;
}

export const ColorScopesView = memo(function ColorScopesView({
  open,
  embedded = false,
}: ColorScopesViewProps) {
  const [colorMatrix, setColorMatrix] = useState<ScopeColorMatrix>(() => loadColorMatrix());
  const [rangeMode, setRangeMode] = useState<ScopeRangeMode>(() => loadRangeMode());
  const captureFrame = usePlaybackStore((s) => s.captureFrame);
  const captureFrameImageData = usePlaybackStore((s) => s.captureFrameImageData);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const paradeCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveTickRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'live' | 'error'>('idle');

  useEffect(() => {
    try {
      localStorage.setItem(COLOR_MATRIX_STORAGE_KEY, colorMatrix);
    } catch {
      // ignore localStorage write errors
    }
  }, [colorMatrix]);

  useEffect(() => {
    try {
      localStorage.setItem(RANGE_MODE_STORAGE_KEY, rangeMode);
    } catch {
      // ignore localStorage write errors
    }
  }, [rangeMode]);

  const drawFromCapture = useCallback(async (retryCount = 0) => {
    if (!open || (!captureFrameImageData && !captureFrame)) return;
    const getRequestedFrame = () => {
      const state = usePlaybackStore.getState();
      return state.previewFrame ?? state.currentFrame;
    };
    const requestedFrame = getRequestedFrame();

    const waveformCanvas = waveformCanvasRef.current;
    const paradeCanvas = paradeCanvasRef.current;
    const vectorscopeCanvas = vectorscopeCanvasRef.current;
    const histogramCanvas = histogramCanvasRef.current;
    if (!waveformCanvas || !vectorscopeCanvas) return;

    const waveformSize = ensureCanvasSize(
      waveformCanvas,
      WAVEFORM_WIDTH,
      WAVEFORM_HEIGHT,
      MAX_SCOPE_WIDTH,
      MAX_SCOPE_HEIGHT
    );
    const paradeSize = paradeCanvas
      ? ensureCanvasSize(paradeCanvas, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, MAX_SCOPE_WIDTH, MAX_SCOPE_HEIGHT)
      : null;
    const histogramSize = histogramCanvas
      ? ensureCanvasSize(histogramCanvas, WAVEFORM_WIDTH, WAVEFORM_HEIGHT, MAX_SCOPE_WIDTH, MAX_SCOPE_HEIGHT)
      : null;
    const vectorscopeSizeRect = ensureCanvasSize(
      vectorscopeCanvas,
      VECTORSCOPE_SIZE,
      VECTORSCOPE_SIZE,
      MAX_VECTORSCOPE_SIZE,
      MAX_VECTORSCOPE_SIZE
    );
    const vectorscopeSize = Math.max(2, Math.min(vectorscopeSizeRect.width, vectorscopeSizeRect.height));
    if (vectorscopeCanvas.width !== vectorscopeSize || vectorscopeCanvas.height !== vectorscopeSize) {
      vectorscopeCanvas.width = vectorscopeSize;
      vectorscopeCanvas.height = vectorscopeSize;
    }

    const waveformCtx = waveformCanvas.getContext('2d');
    const paradeCtx = paradeCanvas?.getContext('2d') ?? null;
    const vectorscopeCtx = vectorscopeCanvas.getContext('2d');
    const histogramCtx = histogramCanvas?.getContext('2d') ?? null;
    if (!waveformCtx || !vectorscopeCtx) return;

    try {
      const sampleWidth = isPlaying ? SAMPLE_WIDTH_PLAYING : SAMPLE_WIDTH_PAUSED;
      const sampleHeight = isPlaying ? SAMPLE_HEIGHT_PLAYING : SAMPLE_HEIGHT_PAUSED;
      let imageData: ImageData | null = null;

      if (captureFrameImageData) {
        imageData = await captureFrameImageData({
          width: sampleWidth,
          height: sampleHeight,
        });
      }

      // Backward-compatible fallback for older capture providers.
      if (!imageData && captureFrame) {
        const frameDataUrl = await captureFrame({
          width: sampleWidth,
          height: sampleHeight,
          // JPEG encoding is generally cheaper than WebP in this high-frequency capture path.
          format: 'image/jpeg',
          quality: isPlaying ? 0.72 : 0.85,
        });
        if (frameDataUrl) {
          const img = new Image();
          img.src = frameDataUrl;
          await img.decode();

          let sampleCanvas = sampleCanvasRef.current;
          if (!sampleCanvas) {
            sampleCanvas = document.createElement('canvas');
            sampleCanvasRef.current = sampleCanvas;
          }
          if (sampleCanvas.width !== sampleWidth || sampleCanvas.height !== sampleHeight) {
            sampleCanvas.width = sampleWidth;
            sampleCanvas.height = sampleHeight;
          }
          const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
          if (!sampleCtx) return;

          sampleCtx.clearRect(0, 0, sampleWidth, sampleHeight);
          sampleCtx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
          imageData = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);
        }
      }

      if (!imageData) {
        setStatus('idle');
        return;
      }

      const latestRequestedFrame = getRequestedFrame();
      if (latestRequestedFrame !== requestedFrame) {
        // Skip stale captures (common when skimming stops mid-capture) and refresh once.
        if (retryCount < 1) {
          await drawFromCapture(retryCount + 1);
        }
        return;
      }

      drawWaveform(imageData, waveformCtx, colorMatrix, rangeMode, waveformSize.width, waveformSize.height);
      const drawHeavyScopes = !isPlaying || liveTickRef.current % 2 === 0;
      liveTickRef.current += 1;
      if (embedded && paradeCtx && paradeSize && drawHeavyScopes) {
        drawParade(imageData, paradeCtx, rangeMode, paradeSize.width, paradeSize.height);
      }
      drawVectorscope(imageData, vectorscopeCtx, colorMatrix, vectorscopeSize);
      if (embedded && histogramCtx && histogramSize && drawHeavyScopes) {
        drawHistogram(imageData, histogramCtx, colorMatrix, rangeMode, histogramSize.width, histogramSize.height);
      }
      setStatus('live');
    } catch {
      setStatus('error');
    }
  }, [captureFrameImageData, captureFrame, open, colorMatrix, rangeMode, embedded, isPlaying]);

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
        await new Promise((r) => setTimeout(r, LIVE_UPDATE_INTERVAL_MS));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isPlaying, drawFromCapture]);

  if (!open) return null;

  return (
    <div
      className={cn(
        embedded
          ? 'h-full rounded-md border border-border bg-background p-2'
          : 'absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-2 pointer-events-none'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Scopes</div>
          <div className="flex items-center gap-1">
            <Button
              variant={colorMatrix === 'bt709' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => setColorMatrix('bt709')}
            >
              709
            </Button>
            <Button
              variant={colorMatrix === 'bt601' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => setColorMatrix('bt601')}
            >
              601
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={rangeMode === 'full' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => setRangeMode('full')}
            >
              Full
            </Button>
            <Button
              variant={rangeMode === 'legal' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => setRangeMode('legal')}
            >
              Legal
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Activity className={`w-3 h-3 ${status === 'live' ? 'text-emerald-500' : status === 'error' ? 'text-red-500' : ''}`} />
          {status === 'live'
            ? `live ${colorMatrix === 'bt709' ? '709' : '601'} ${rangeMode}`
            : status === 'error'
            ? 'err'
            : 'idle'}
        </div>
      </div>
      {embedded ? (
        <div className="h-[calc(100%-22px)] min-h-0 flex gap-3">
          <div className="min-w-0 flex-1 grid grid-cols-2 gap-3 auto-rows-fr">
            <div className="flex min-h-0 flex-col">
              <div className="text-[10px] mb-1 text-muted-foreground">Waveform</div>
              <canvas
                ref={waveformCanvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                className="w-full min-h-[160px] flex-1 rounded border border-border/70 bg-black/80"
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="text-[10px] mb-1 text-muted-foreground">RGB Parade</div>
              <canvas
                ref={paradeCanvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                className="w-full min-h-[160px] flex-1 rounded border border-border/70 bg-black/80"
              />
            </div>
            <div className="col-span-2 flex min-h-0 flex-col">
              <div className="text-[10px] mb-1 text-muted-foreground">Histogram</div>
              <canvas
                ref={histogramCanvasRef}
                width={WAVEFORM_WIDTH}
                height={WAVEFORM_HEIGHT}
                className="w-full min-h-[160px] flex-1 rounded border border-border/70 bg-black/80"
              />
            </div>
          </div>

          <div className="basis-[32%] min-w-[220px] max-w-[380px] flex min-h-0 flex-col">
            <div className="text-[10px] mb-1 text-muted-foreground">Vectorscope</div>
            <div className="flex flex-1 min-h-0 items-center justify-center rounded border border-border/70 bg-black/80">
              <canvas
                ref={vectorscopeCanvasRef}
                width={VECTORSCOPE_SIZE}
                height={VECTORSCOPE_SIZE}
                className="h-full min-h-[220px] max-h-[460px] w-auto max-w-full aspect-square"
              />
            </div>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
});
