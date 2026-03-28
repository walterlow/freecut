import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { usePlaybackStore } from '@/shared/state/playback';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';
import { ScopeRenderer } from '@/infrastructure/gpu/scopes';

const SAMPLE_WIDTH_PAUSED = 384;
const SAMPLE_HEIGHT_PAUSED = 216;
const SAMPLE_WIDTH_PLAYING = 256;
const SAMPLE_HEIGHT_PLAYING = 144;
const GPU_INTERVAL = 66; // ~15fps
const CPU_INTERVAL = 220;
const COLOR_MATRIX_STORAGE_KEY = 'timeline:scopes:colorMatrix';
const RANGE_MODE_STORAGE_KEY = 'timeline:scopes:rangeMode';
const STACK_LAYOUT_STORAGE_KEY = 'timeline:scopes:stackLayout';

type ScopeColorMatrix = 'bt709' | 'bt601';
type ScopeRangeMode = 'full' | 'legal';
type ScopeViewMode = 'rgb' | 'r' | 'g' | 'b' | 'luma';
type StackScopeLayout = 'three-up' | 'all';

const VIEW_MODE_NUM: Record<ScopeViewMode, number> = { rgb: 0, r: 1, g: 2, b: 3, luma: 4 };

interface MatrixCoefficients { kr: number; kb: number }

function getMatrixCoefficients(matrix: ScopeColorMatrix): MatrixCoefficients {
  return matrix === 'bt601' ? { kr: 0.299, kb: 0.114 } : { kr: 0.2126, kb: 0.0722 };
}

function loadColorMatrix(): ScopeColorMatrix {
  try {
    const v = localStorage.getItem(COLOR_MATRIX_STORAGE_KEY);
    if (v === 'bt601' || v === 'bt709') return v;
  } catch { /* ignore */ }
  return 'bt709';
}

function loadRangeMode(): ScopeRangeMode {
  try {
    const v = localStorage.getItem(RANGE_MODE_STORAGE_KEY);
    if (v === 'full' || v === 'legal') return v;
  } catch { /* ignore */ }
  return 'full';
}

function loadStackLayout(): StackScopeLayout {
  try {
    const v = localStorage.getItem(STACK_LAYOUT_STORAGE_KEY);
    if (v === 'three-up' || v === 'all') return v;
  } catch { /* ignore */ }
  return 'three-up';
}

// ── CPU fallback drawing functions ──────────────────────────────────────────

function normalizeRange(value: number, rangeMode: ScopeRangeMode): number {
  if (rangeMode === 'legal') {
    const legalMin = 16 / 255;
    const legalMax = 235 / 255;
    return Math.max(0, Math.min(1, (value - legalMin) / (legalMax - legalMin)));
  }
  return Math.max(0, Math.min(1, value));
}

function drawIreGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  for (const level of [0, 25, 50, 75, 100]) {
    const y = Math.round(height - 1 - (level / 100) * (height - 1));
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(level), 4, Math.max(10, y - 2));
  }
  ctx.restore();
}

function cpuDrawWaveform(
  imageData: ImageData, ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix, rangeMode: ScopeRangeMode, w: number, h: number,
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const density = new Uint16Array(w * h);
  let maxD = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;
      const luma = normalizeRange(kr * r + kg * g + kb * b, rangeMode);
      const px = Math.floor((x / Math.max(1, width - 1)) * (w - 1));
      const py = h - 1 - Math.floor(luma * (h - 1));
      const di = py * w + px;
      const next = (density[di] ?? 0) + 1;
      density[di] = next;
      if (next > maxD) maxD = next;
    }
  }
  const image = ctx.createImageData(w, h);
  const out = image.data;
  const logDiv = Math.log1p(Math.max(1, maxD));
  for (let i = 0; i < density.length; i++) {
    const bucket = density[i] ?? 0;
    if (bucket <= 0) continue;
    const d = Math.log1p(bucket) / logDiv;
    if (d <= 0) continue;
    const oi = i * 4;
    out[oi] = 40;
    out[oi + 1] = Math.min(255, Math.round(65 + d * 190));
    out[oi + 2] = 120;
    out[oi + 3] = Math.min(255, Math.round(95 + d * 160));
  }
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);
  ctx.putImageData(image, 0, 0);
  drawIreGrid(ctx, w, h);
}

function cpuDrawParade(
  imageData: ImageData, ctx: CanvasRenderingContext2D,
  rangeMode: ScopeRangeMode, w: number, h: number,
): void {
  const { data, width, height } = imageData;
  const density = new Uint16Array(w * h);
  let maxD = 0;
  const sW = Math.floor(w / 3);
  const colors: Array<[number, number, number]> = [[255, 80, 80], [60, 255, 120], [90, 130, 255]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ch = [(data[idx] ?? 0) / 255, (data[idx + 1] ?? 0) / 255, (data[idx + 2] ?? 0) / 255];
      const lx = Math.floor((x / Math.max(1, width - 1)) * (sW - 1));
      for (let c = 0; c < 3; c++) {
        const v = normalizeRange(ch[c] ?? 0, rangeMode);
        const px = c * sW + lx;
        const py = h - 1 - Math.floor(v * (h - 1));
        const di = py * w + px;
        const next = (density[di] ?? 0) + 1;
        density[di] = next;
        if (next > maxD) maxD = next;
      }
    }
  }
  const image = ctx.createImageData(w, h);
  const out = image.data;
  const logDiv = Math.log1p(Math.max(1, maxD));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bucket = density[i] ?? 0;
      if (bucket <= 0) continue;
      const d = Math.log1p(bucket) / logDiv;
      const channel = Math.min(2, Math.floor(x / Math.max(1, sW)));
      const color = colors[channel] ?? [180, 180, 180];
      const oi = i * 4;
      out[oi] = Math.min(255, Math.round((color[0] ?? 180) * (0.25 + 0.75 * d)));
      out[oi + 1] = Math.min(255, Math.round((color[1] ?? 180) * (0.25 + 0.75 * d)));
      out[oi + 2] = Math.min(255, Math.round((color[2] ?? 180) * (0.25 + 0.75 * d)));
      out[oi + 3] = Math.min(255, Math.round(85 + d * 160));
    }
  }
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, w, h);
  ctx.putImageData(image, 0, 0);
  drawIreGrid(ctx, w, h);
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 1;
  for (let n = 1; n < 3; n++) {
    const xp = n * sW;
    ctx.beginPath();
    ctx.moveTo(xp + 0.5, 0);
    ctx.lineTo(xp + 0.5, h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText('R', 8, 12);
  ctx.fillText('G', sW + 8, 12);
  ctx.fillText('B', sW * 2 + 8, 12);
  ctx.restore();
}

function cpuDrawHistogram(
  imageData: ImageData, ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix, rangeMode: ScopeRangeMode, w: number, h: number,
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const bins = new Uint32Array(256);
  let maxBin = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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
  ctx.fillRect(0, 0, w, h);
  drawIreGrid(ctx, w, h);
  const logDiv = Math.log1p(Math.max(1, maxBin));
  for (let i = 0; i < 256; i++) {
    const bucket = bins[i] ?? 0;
    if (bucket <= 0) continue;
    const strength = Math.log1p(bucket) / logDiv;
    const x = Math.round((i / 255) * (w - 1));
    const barH = Math.max(1, Math.round(strength * (h - 1)));
    ctx.fillStyle = `rgba(116, 232, 195, ${0.35 + strength * 0.65})`;
    ctx.fillRect(x, h - barH, Math.max(1, Math.round(w / 256)), barH);
  }
}

function cpuDrawVectorscope(
  imageData: ImageData, ctx: CanvasRenderingContext2D,
  matrix: ScopeColorMatrix, size: number,
): void {
  const { kr, kb } = getMatrixCoefficients(matrix);
  const kg = 1 - kr - kb;
  const { data, width, height } = imageData;
  const density = new Uint32Array(size * size);
  let maxD = 0;
  const center = Math.floor(size / 2);
  const radius = center - 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = (data[idx] ?? 0) / 255;
      const g = (data[idx + 1] ?? 0) / 255;
      const b = (data[idx + 2] ?? 0) / 255;
      const yP = kr * r + kg * g + kb * b;
      const cb = (b - yP) / (2 * (1 - kb));
      const cr = (r - yP) / (2 * (1 - kr));
      const px = Math.round(center + cb * radius * 2);
      const py = Math.round(center - cr * radius * 2);
      if (px < 0 || px >= size || py < 0 || py >= size) continue;
      const di = py * size + px;
      const next = (density[di] ?? 0) + 1;
      density[di] = next;
      if (next > maxD) maxD = next;
    }
  }
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, size, size);
  const image = ctx.createImageData(size, size);
  const out = image.data;
  const logDiv = Math.log1p(Math.max(1, maxD));
  for (let i = 0; i < density.length; i++) {
    const bucket = density[i] ?? 0;
    if (bucket <= 0) continue;
    const d = Math.log1p(bucket) / logDiv;
    if (d <= 0) continue;
    const oi = i * 4;
    out[oi] = 70;
    out[oi + 1] = Math.min(255, Math.round(70 + d * 185));
    out[oi + 2] = 255;
    out[oi + 3] = Math.min(255, Math.round(90 + d * 165));
  }
  ctx.putImageData(image, 0, 0);
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
  ctx.lineTo(center, size);
  ctx.moveTo(0, center);
  ctx.lineTo(size, center);
  ctx.stroke();
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function ensureCanvasSize(
  canvas: HTMLCanvasElement,
  fallbackW: number,
  fallbackH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(2, Math.min(maxW, Math.round(rect.width || fallbackW)));
  const height = Math.max(2, Math.min(maxH, Math.round(rect.height || fallbackH)));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height };
}

function ScopeModeBar({
  mode,
  onChange,
}: {
  mode: ScopeViewMode;
  onChange: (m: ScopeViewMode) => void;
}) {
  const modes: Array<{ value: ScopeViewMode; label: string; activeColor?: string }> = [
    { value: 'rgb', label: 'RGB' },
    { value: 'r', label: 'R', activeColor: '#ff6666' },
    { value: 'g', label: 'G', activeColor: '#66cc66' },
    { value: 'b', label: 'B', activeColor: '#6688ff' },
    { value: 'luma', label: 'Y', activeColor: '#ccccaa' },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {modes.map((m) => (
        <button
          key={m.value}
          className={cn(
            'h-4 px-1 text-[9px] font-semibold font-mono rounded transition-colors',
            mode === m.value
              ? 'text-white'
              : 'text-muted-foreground/60 hover:text-muted-foreground',
          )}
          style={
            mode === m.value
              ? { backgroundColor: `${m.activeColor ?? '#888'}33`, borderBottom: `1.5px solid ${m.activeColor ?? '#888'}` }
              : undefined
          }
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── GPU canvas sizing ───────────────────────────────────────────────────────

function useGpuCanvasResize(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  aspectRatio?: number,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      let w = width;
      let h = height;
      if (aspectRatio) {
        const containedHeight = width / aspectRatio;
        if (containedHeight <= height) {
          h = containedHeight;
        } else {
          h = height;
          w = height * aspectRatio;
        }
      }
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.width = `${Math.round(w)}px`;
        canvas.style.height = `${Math.round(h)}px`;
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [aspectRatio, canvasRef, containerRef, enabled]);
}

// ── Main component ──────────────────────────────────────────────────────────

interface ColorScopesViewProps {
  open: boolean;
  embedded?: boolean;
  embeddedLayout?: 'grid' | 'stack';
}

export const ColorScopesView = memo(function ColorScopesView({
  open,
  embedded = false,
  embeddedLayout = 'grid',
}: ColorScopesViewProps) {
  const [colorMatrix, setColorMatrix] = useState<ScopeColorMatrix>(() => loadColorMatrix());
  const [rangeMode, setRangeMode] = useState<ScopeRangeMode>(() => loadRangeMode());
  const [status, setStatus] = useState<'idle' | 'live' | 'error'>('idle');
  const [gpuReady, setGpuReady] = useState<boolean | null>(null); // null = pending
  const [waveformMode, setWaveformMode] = useState<ScopeViewMode>('luma');
  const [histogramMode, setHistogramMode] = useState<ScopeViewMode>('rgb');
  const [stackLayout, setStackLayout] = useState<StackScopeLayout>(() => loadStackLayout());

  const captureFrameImageData = usePlaybackStore((s) => s.captureFrameImageData);
  const captureFrame = usePlaybackStore((s) => s.captureFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const isEmbeddedStackLayout = embedded && embeddedLayout === 'stack';
  const showHistogram = embedded && (!isEmbeddedStackLayout || stackLayout === 'all');

  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const paradeCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const histogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const paradeContainerRef = useRef<HTMLDivElement>(null);
  const vectorscopeContainerRef = useRef<HTMLDivElement>(null);
  const histogramContainerRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<ScopeRenderer | null>(null);
  const gpuCtxCacheRef = useRef(new Map<HTMLCanvasElement, GPUCanvasContext>());
  const gpuInitedRef = useRef(false);
  const gpuRenderInFlightRef = useRef(false);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveTickRef = useRef(0);

  // Refs for values read inside RAF loop (avoid restarting loop on every change)
  const colorMatrixRef = useRef(colorMatrix);
  colorMatrixRef.current = colorMatrix;
  const rangeModeRef = useRef(rangeMode);
  rangeModeRef.current = rangeMode;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const showHistogramRef = useRef(showHistogram);
  showHistogramRef.current = showHistogram;
  const waveformModeRef = useRef(waveformMode);
  waveformModeRef.current = waveformMode;
  const histogramModeRef = useRef(histogramMode);
  histogramModeRef.current = histogramMode;

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem(COLOR_MATRIX_STORAGE_KEY, colorMatrix); } catch { /* ignore */ }
  }, [colorMatrix]);
  useEffect(() => {
    try { localStorage.setItem(RANGE_MODE_STORAGE_KEY, rangeMode); } catch { /* ignore */ }
  }, [rangeMode]);
  useEffect(() => {
    try { localStorage.setItem(STACK_LAYOUT_STORAGE_KEY, stackLayout); } catch { /* ignore */ }
  }, [stackLayout]);

  // DPR-aware sizing for GPU canvases
  useGpuCanvasResize(waveformCanvasRef, waveformContainerRef);
  useGpuCanvasResize(paradeCanvasRef, paradeContainerRef);
  useGpuCanvasResize(histogramCanvasRef, histogramContainerRef, undefined, showHistogram);
  useGpuCanvasResize(vectorscopeCanvasRef, vectorscopeContainerRef, 1);

  // ── GPU initialization ──────────────────────────────────────────────────

  useEffect(() => {
    if (!open || gpuInitedRef.current) return;
    gpuInitedRef.current = true;
    ScopeRenderer.create().then((r) => {
      if (r) {
        rendererRef.current = r;
        setGpuReady(true);
      } else {
        setGpuReady(false);
      }
    });
  }, [open]);

  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
      gpuCtxCacheRef.current.clear();
    };
  }, []);

  // ── GPU render loop ─────────────────────────────────────────────────────

  const getGpuCtx = useCallback((canvas: HTMLCanvasElement | null): GPUCanvasContext | null => {
    if (!canvas) return null;
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const cache = gpuCtxCacheRef.current;
    let ctx = cache.get(canvas);
    if (ctx) return ctx;
    ctx = renderer.configureCanvas(canvas) ?? undefined;
    if (ctx) cache.set(canvas, ctx);
    return ctx ?? null;
  }, []);

  useEffect(() => {
    if (gpuReady !== true || !open) return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    let cancelled = false;
    let lastTime = 0;

    const tick = (time: number) => {
      if (cancelled) return;
      if (time - lastTime >= GPU_INTERVAL && !gpuRenderInFlightRef.current) {
        lastTime = time;
        void renderGpuFrame();
      }
      requestAnimationFrame(tick);
    };

    const renderGpuFrame = async () => {
      if (gpuRenderInFlightRef.current) return;
      gpuRenderInFlightRef.current = true;
      const { kr, kb } = getMatrixCoefficients(colorMatrixRef.current);
      const [rangeMin, rangeMax] = rangeModeRef.current === 'legal'
        ? [16 / 255, 235 / 255]
        : [0, 1];
      renderer.setMatrix(kr, kb);
      renderer.setRange(rangeMin, rangeMax);

      try {
        // Try near-zero-copy canvas path first
        const canvasSourceFn = usePlaybackStore.getState().captureCanvasSource;
        if (canvasSourceFn) {
          const source = await canvasSourceFn();
          if (source && !cancelled) {
            renderer.uploadFromCanvas(source);
          } else if (!cancelled) {
            // No source available — try ImageData fallback
            await fallbackToImageData(renderer);
          }
        } else {
          await fallbackToImageData(renderer);
        }

        if (cancelled) return;

        // Render each visible scope
        const wfCtx = getGpuCtx(waveformCanvasRef.current);
        const waveformRequests: Array<{ ctx: GPUCanvasContext; mode: number }> = [];
        if (wfCtx) {
          waveformRequests.push({ ctx: wfCtx, mode: VIEW_MODE_NUM[waveformModeRef.current] });
        }

        if (embeddedRef.current) {
          const parCtx = getGpuCtx(paradeCanvasRef.current);
          if (parCtx) {
            waveformRequests.push({ ctx: parCtx, mode: 5 }); // parade mode
          }

          if (showHistogramRef.current) {
            const histCtx = getGpuCtx(histogramCanvasRef.current);
            if (histCtx) renderer.renderHistogram(histCtx, VIEW_MODE_NUM[histogramModeRef.current]);
          }
        }
        if (waveformRequests.length > 0) {
          renderer.renderWaveforms(waveformRequests);
        }

        const vsCtx = getGpuCtx(vectorscopeCanvasRef.current);
        if (vsCtx) renderer.renderVectorscope(vsCtx);

        setStatus('live');
      } catch {
        setStatus('error');
      } finally {
        gpuRenderInFlightRef.current = false;
      }
    };

    const fallbackToImageData = async (r: ScopeRenderer) => {
      const state = usePlaybackStore.getState();
      const captureFn = state.captureFrameImageData;
      if (!captureFn) return;
      const sampleW = isPlayingRef.current ? SAMPLE_WIDTH_PLAYING : SAMPLE_WIDTH_PAUSED;
      const sampleH = isPlayingRef.current ? SAMPLE_HEIGHT_PLAYING : SAMPLE_HEIGHT_PAUSED;
      const imageData = await captureFn({ width: sampleW, height: sampleH });
      if (imageData) r.uploadFrame(imageData);
    };

    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, [gpuReady, open, getGpuCtx]);

  // ── CPU fallback render ─────────────────────────────────────────────────

  const cpuDraw = useCallback(async (retryCount = 0) => {
    if (!open || gpuReady !== false) return;
    if (!captureFrameImageData && !captureFrame) return;

    const getRequestedFrame = () => {
      const s = usePlaybackStore.getState();
      return s.previewFrame ?? s.currentFrame;
    };
    const requestedFrame = getRequestedFrame();

    const wfCanvas = waveformCanvasRef.current;
    const vsCanvas = vectorscopeCanvasRef.current;
    if (!wfCanvas || !vsCanvas) return;

    const wfSize = ensureCanvasSize(wfCanvas, 512, 256, 1920, 1080);
    const parSize = paradeCanvasRef.current
      ? ensureCanvasSize(paradeCanvasRef.current, 512, 256, 1920, 1080)
      : null;
    const histSize = histogramCanvasRef.current
      ? ensureCanvasSize(histogramCanvasRef.current, 512, 256, 1920, 1080)
      : null;
    const vsRect = ensureCanvasSize(vsCanvas, 256, 256, 1024, 1024);
    const vsSize = Math.max(2, Math.min(vsRect.width, vsRect.height));
    if (vsCanvas.width !== vsSize || vsCanvas.height !== vsSize) {
      vsCanvas.width = vsSize;
      vsCanvas.height = vsSize;
    }

    const wfCtx = wfCanvas.getContext('2d');
    const parCtx = paradeCanvasRef.current?.getContext('2d') ?? null;
    const vsCtx = vsCanvas.getContext('2d');
    const histCtx = histogramCanvasRef.current?.getContext('2d') ?? null;
    if (!wfCtx || !vsCtx) return;

    try {
      const sampleW = isPlaying ? SAMPLE_WIDTH_PLAYING : SAMPLE_WIDTH_PAUSED;
      const sampleH = isPlaying ? SAMPLE_HEIGHT_PLAYING : SAMPLE_HEIGHT_PAUSED;
      let imageData: ImageData | null = null;

      if (captureFrameImageData) {
        imageData = await captureFrameImageData({ width: sampleW, height: sampleH });
      }

      if (!imageData && captureFrame) {
        const dataUrl = await captureFrame({
          width: sampleW, height: sampleH,
          format: 'image/jpeg',
          quality: isPlaying ? 0.72 : 0.85,
        });
        if (dataUrl) {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          let sc = sampleCanvasRef.current;
          if (!sc) { sc = document.createElement('canvas'); sampleCanvasRef.current = sc; }
          if (sc.width !== sampleW || sc.height !== sampleH) { sc.width = sampleW; sc.height = sampleH; }
          const sctx = sc.getContext('2d', { willReadFrequently: true });
          if (!sctx) return;
          sctx.clearRect(0, 0, sampleW, sampleH);
          sctx.drawImage(img, 0, 0, sampleW, sampleH);
          imageData = sctx.getImageData(0, 0, sampleW, sampleH);
        }
      }

      if (!imageData) { setStatus('idle'); return; }
      if (getRequestedFrame() !== requestedFrame) {
        if (retryCount < 1) await cpuDraw(retryCount + 1);
        return;
      }

      cpuDrawWaveform(imageData, wfCtx, colorMatrix, rangeMode, wfSize.width, wfSize.height);
      const drawHeavy = !isPlaying || liveTickRef.current % 2 === 0;
      liveTickRef.current += 1;
      if (embedded && parCtx && parSize && drawHeavy) {
        cpuDrawParade(imageData, parCtx, rangeMode, parSize.width, parSize.height);
      }
      cpuDrawVectorscope(imageData, vsCtx, colorMatrix, vsSize);
      if (showHistogram && histCtx && histSize && drawHeavy) {
        cpuDrawHistogram(imageData, histCtx, colorMatrix, rangeMode, histSize.width, histSize.height);
      }
      setStatus('live');
    } catch {
      setStatus('error');
    }
  }, [captureFrameImageData, captureFrame, open, gpuReady, colorMatrix, rangeMode, embedded, isPlaying, showHistogram]);

  // CPU: update on frame change when paused
  useEffect(() => {
    if (gpuReady !== false || !open || isPlaying) return;
    void cpuDraw();
  }, [gpuReady, open, isPlaying, currentFrame, previewFrame, cpuDraw]);

  // CPU: polling loop during playback
  useEffect(() => {
    if (gpuReady !== false || !open || !isPlaying) return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        await cpuDraw();
        await new Promise((r) => setTimeout(r, CPU_INTERVAL));
      }
    })();
    return () => { cancelled = true; };
  }, [gpuReady, open, isPlaying, cpuDraw]);

  if (!open) return null;

  return (
    <div
      className={cn(
        embedded
          ? 'h-full rounded-md border border-border bg-background p-2'
          : 'absolute bottom-3 right-3 z-20 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-2 pointer-events-none',
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
          {isEmbeddedStackLayout && (
            <div className="flex items-center gap-1">
              <Button
                variant={stackLayout === 'three-up' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => setStackLayout('three-up')}
              >
                3-Up
              </Button>
              <Button
                variant={stackLayout === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => setStackLayout('all')}
              >
                All
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Activity
            className={`w-3 h-3 ${status === 'live' ? 'text-emerald-500' : status === 'error' ? 'text-red-500' : ''}`}
          />
          {status === 'live'
            ? `${gpuReady ? 'gpu' : 'cpu'} ${colorMatrix === 'bt709' ? '709' : '601'} ${rangeMode}`
            : status === 'error'
              ? 'err'
              : 'idle'}
        </div>
      </div>
      {embedded ? (
        embeddedLayout === 'stack' ? (
          <div className="h-[calc(100%-22px)] min-h-0 flex flex-col gap-3">
            <div className="flex min-h-0 flex-[1.02] flex-col">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">Waveform</div>
                {gpuReady && (
                  <ScopeModeBar mode={waveformMode} onChange={setWaveformMode} />
                )}
              </div>
              <div
                ref={waveformContainerRef}
                className="flex-1 min-h-[96px] rounded border border-border/70 bg-black/80"
              >
                <canvas ref={waveformCanvasRef} className="w-full h-full" />
              </div>
            </div>

            <div className="flex min-h-0 flex-[1.08] flex-col">
              <div className="text-[10px] mb-1 text-muted-foreground">RGB Parade</div>
              <div
                ref={paradeContainerRef}
                className="flex-1 min-h-[104px] rounded border border-border/70 bg-black/80"
              >
                <canvas ref={paradeCanvasRef} className="w-full h-full" />
              </div>
            </div>

            <div className={cn('flex min-h-0 min-w-0 flex-col', showHistogram ? 'flex-[0.9]' : 'flex-[1.02]')}>
              <div className="text-[10px] mb-1 text-muted-foreground">Vectorscope</div>
              <div
                ref={vectorscopeContainerRef}
                className={cn(
                  'mx-auto flex min-h-0 min-w-0 w-full flex-1 items-center justify-center overflow-hidden rounded border border-border/70 bg-black/80',
                  showHistogram ? 'max-w-[272px]' : 'max-w-[320px]',
                )}
              >
                <canvas ref={vectorscopeCanvasRef} className="max-w-full max-h-full aspect-square" />
              </div>
            </div>

            {showHistogram && (
              <div className="flex min-h-0 flex-[0.88] flex-col">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[10px] text-muted-foreground">Histogram</div>
                  {gpuReady && (
                    <ScopeModeBar mode={histogramMode} onChange={setHistogramMode} />
                  )}
                </div>
                <div
                  ref={histogramContainerRef}
                  className="flex-1 min-h-[88px] rounded border border-border/70 bg-black/80"
                >
                  <canvas ref={histogramCanvasRef} className="w-full h-full" />
                </div>
              </div>
            )}
          </div>
        ) : (
        <div className="h-[calc(100%-22px)] min-h-0 flex gap-3">
          <div className="min-w-0 flex-1 grid grid-cols-2 gap-3 auto-rows-fr">
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-muted-foreground">Waveform</div>
                {gpuReady && (
                  <ScopeModeBar mode={waveformMode} onChange={setWaveformMode} />
                )}
              </div>
              <div ref={waveformContainerRef} className="flex-1 min-h-[160px] rounded border border-border/70 bg-black/80">
                <canvas ref={waveformCanvasRef} className="w-full h-full" />
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="text-[10px] mb-1 text-muted-foreground">RGB Parade</div>
              <div ref={paradeContainerRef} className="flex-1 min-h-[160px] rounded border border-border/70 bg-black/80">
                <canvas ref={paradeCanvasRef} className="w-full h-full" />
              </div>
            </div>
            <div className="col-span-2 flex min-h-0 flex-col">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-muted-foreground">Histogram</div>
                {gpuReady && (
                  <ScopeModeBar mode={histogramMode} onChange={setHistogramMode} />
                )}
              </div>
              <div ref={histogramContainerRef} className="flex-1 min-h-[160px] rounded border border-border/70 bg-black/80">
                <canvas ref={histogramCanvasRef} className="w-full h-full" />
              </div>
            </div>
          </div>
          <div className="basis-[32%] min-w-[220px] max-w-[380px] flex min-h-0 flex-col">
            <div className="text-[10px] mb-1 text-muted-foreground">Vectorscope</div>
            <div
              ref={vectorscopeContainerRef}
              className="flex flex-1 min-h-0 items-center justify-center rounded border border-border/70 bg-black/80"
            >
              <canvas ref={vectorscopeCanvasRef} className="max-w-full max-h-full aspect-square" />
            </div>
          </div>
        </div>
        )
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] text-muted-foreground">Waveform</div>
              {gpuReady && (
                <ScopeModeBar mode={waveformMode} onChange={setWaveformMode} />
              )}
            </div>
            <div ref={waveformContainerRef} className="w-[220px] h-[110px] rounded border border-border/70 bg-black/80">
              <canvas ref={waveformCanvasRef} className="w-full h-full" />
            </div>
          </div>
          <div>
            <div className="text-[10px] mb-1 text-muted-foreground">Vectorscope</div>
            <div ref={vectorscopeContainerRef} className="w-[160px] h-[160px] rounded border border-border/70 bg-black/80">
              <canvas ref={vectorscopeCanvasRef} className="w-full h-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
