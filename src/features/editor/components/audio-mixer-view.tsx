import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { linearLevelToPercent } from './audio-meter-utils';
import { setMixerLiveGains, clearMixerLiveGains } from '@/shared/state/mixer-live-gain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioMixerTrack {
  id: string;
  name: string;
  kind?: 'video' | 'audio';
  muted: boolean;
  solo: boolean;
  volume: number; // dB, -60 to +12
  itemIds: string[]; // item IDs on this track (for live gain during fader drag)
}

export interface AudioMixerViewProps {
  tracks: AudioMixerTrack[];
  perTrackLevels: Map<string, {
    left: number;
    right: number;
    unresolvedSourceCount: number;
    resolvedSourceCount: number;
  }>;
  masterEstimate: {
    left: number;
    right: number;
    unresolvedSourceCount: number;
    resolvedSourceCount: number;
  };
  isPlaying: boolean;
  onTrackVolumeChange: (trackId: string, volumeDb: number) => void;
  onTrackMuteToggle: (trackId: string) => void;
  onTrackSoloToggle: (trackId: string) => void;
  headerExtra?: ReactNode;
}

// ---------------------------------------------------------------------------
// dB <-> fader mapping
// ---------------------------------------------------------------------------

const FADER_DB_MIN = -60;
const FADER_DB_MAX = 12;
const FADER_DB_RANGE = FADER_DB_MAX - FADER_DB_MIN; // 72
const FADER_KNOB_HEIGHT_PX = 20;
const FADER_KNOB_DRAG_TOLERANCE_PX = 14;

function dbToFaderPercent(db: number): number {
  if (!Number.isFinite(db)) return 83.33; // 0 dB default for NaN/Infinity
  const clamped = Math.max(FADER_DB_MIN, Math.min(FADER_DB_MAX, db));
  if (clamped <= FADER_DB_MIN) return 0;
  if (clamped >= FADER_DB_MAX) return 100;
  return ((clamped - FADER_DB_MIN) / FADER_DB_RANGE) * 100;
}

function faderPercentToDb(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return (clamped / 100) * FADER_DB_RANGE + FADER_DB_MIN;
}

function formatFaderDb(db: number): string {
  if (!Number.isFinite(db)) return '+0.0';
  if (db <= FADER_DB_MIN) return '-inf';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Scale marks (shared left column)
// ---------------------------------------------------------------------------

const FADER_SCALE_MARKS = [12, 6, 0, -6, -12, -20, -30, -40, -50, -60] as const;

function getMeterFallbackPercent(params: {
  unresolvedSourceCount: number;
  resolvedSourceCount: number;
  isPlaying: boolean;
}): number {
  if (!params.isPlaying) {
    return 0;
  }

  if (params.unresolvedSourceCount > 0 && params.resolvedSourceCount === 0) {
    return 18;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Channel strip fader (per track)
// ---------------------------------------------------------------------------

interface ChannelFaderProps {
  trackId: string;
  volumeDb: number;
  /** Item IDs on this track — used to set per-item live gain during drag */
  itemIds: string[];
  /** Called once on drag end — triggers store update + markDirty */
  onVolumeChange: (trackId: string, volumeDb: number) => void;
  /** Imperative ref for updating the dB readout during drag (no re-render) */
  dbReadoutRef?: React.RefObject<HTMLDivElement | null>;
}

const ChannelFader = memo(function ChannelFader({
  trackId,
  volumeDb,
  itemIds,
  onVolumeChange,
  dbReadoutRef,
}: ChannelFaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetPercentRef = useRef(0);
  const latestDbRef = useRef(volumeDb);

  // Sync from props when not dragging
  if (!isDraggingRef.current) {
    latestDbRef.current = volumeDb;
  }

  const percentFromPointerEvent = useCallback((e: PointerEvent): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const y = Math.max(0, Math.min(rect.height, rect.bottom - e.clientY));
    return (y / rect.height) * 100;
  }, []);

  const dragOffsetPercentFromPointerEvent = useCallback((e: PointerEvent): number => {
    const el = trackRef.current;
    if (!el) return 0;

    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return 0;

    const pointerYFromBottom = Math.max(0, Math.min(rect.height, rect.bottom - e.clientY));
    const currentPercent = dbToFaderPercent(latestDbRef.current);
    const knobCenterYFromBottom = (currentPercent / 100) * rect.height;
    const pointerIsNearKnob = Math.abs(pointerYFromBottom - knobCenterYFromBottom) <= Math.max(
      FADER_KNOB_DRAG_TOLERANCE_PX,
      FADER_KNOB_HEIGHT_PX / 2,
    );

    if (!pointerIsNearKnob) {
      return 0;
    }

    return currentPercent - ((pointerYFromBottom / rect.height) * 100);
  }, []);

  // Pure DOM update + live audio gain — zero store writes, zero React renders of composition
  const applyDragValue = useCallback((db: number) => {
    latestDbRef.current = db;
    if (knobRef.current) {
      knobRef.current.style.top = `${100 - dbToFaderPercent(db)}%`;
    }
    if (dbReadoutRef?.current) {
      dbReadoutRef.current.textContent = formatFaderDb(db);
    }
    // Compute gain multiplier relative to the committed track volume.
    // The segment's volumeDb already includes the committed trackVolumeDb,
    // so we apply the ratio: 10^(newDb/20) / 10^(committedDb/20)
    const committedDb = volumeDb;
    const gainRatio = Math.pow(10, (db - committedDb) / 20);
    setMixerLiveGains(itemIds.map((id) => ({ itemId: id, gain: gainRatio })));
  }, [dbReadoutRef, itemIds, volumeDb]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      isDraggingRef.current = true;
      dragOffsetPercentRef.current = dragOffsetPercentFromPointerEvent(e.nativeEvent);
      const percent = percentFromPointerEvent(e.nativeEvent);
      const adjustedPercent = Math.max(0, Math.min(100, percent + dragOffsetPercentRef.current));
      applyDragValue(Math.round(faderPercentToDb(adjustedPercent) * 10) / 10);
    },
    [applyDragValue, dragOffsetPercentFromPointerEvent, percentFromPointerEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      const percent = percentFromPointerEvent(e.nativeEvent);
      const adjustedPercent = Math.max(0, Math.min(100, percent + dragOffsetPercentRef.current));
      applyDragValue(Math.round(faderPercentToDb(adjustedPercent) * 10) / 10);
    },
    [applyDragValue, percentFromPointerEvent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDraggingRef.current = false;
      dragOffsetPercentRef.current = 0;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      // Clear live gain overrides, then commit to store (single write)
      clearMixerLiveGains();
      onVolumeChange(trackId, latestDbRef.current);
    },
    [onVolumeChange, trackId],
  );

  const knobPercent = dbToFaderPercent(volumeDb);

  return (
    <div
      ref={trackRef}
      data-track-id={trackId}
      data-fader-root="true"
      className="relative h-full cursor-ns-resize select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Fader track line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-border/60" />

      {/* Unity (0 dB) mark */}
      <div
        className="absolute left-0 right-0 h-px bg-muted-foreground/30"
        style={{ bottom: `${dbToFaderPercent(0)}%` }}
      />

      {/* Fader knob */}
      <div
        ref={knobRef}
        data-track-id={trackId}
        data-fader-knob="true"
        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[14px] h-[20px] rounded-[3px] bg-zinc-400 shadow-[0_1px_3px_rgba(0,0,0,0.5)] border border-zinc-300/30 pointer-events-none"
        style={{ top: `${100 - knobPercent}%` }}
      >
        {/* Grip lines */}
        <div className="absolute inset-x-[2px] top-[6px] h-px bg-zinc-600/60" />
        <div className="absolute inset-x-[2px] top-[9px] h-px bg-zinc-600/60" />
        <div className="absolute inset-x-[2px] top-[12px] h-px bg-zinc-600/60" />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Channel strip
// ---------------------------------------------------------------------------

interface ChannelStripProps {
  track: AudioMixerTrack;
  level: {
    left: number;
    right: number;
    unresolvedSourceCount: number;
    resolvedSourceCount: number;
  } | undefined;
  isPlaying: boolean;
  onVolumeChange: (trackId: string, volumeDb: number) => void;
  onMuteToggle: (trackId: string) => void;
  onSoloToggle: (trackId: string) => void;
}

const ChannelStrip = memo(function ChannelStrip({
  track,
  level,
  isPlaying,
  onVolumeChange,
  onMuteToggle,
  onSoloToggle,
}: ChannelStripProps) {
  const dbReadoutRef = useRef<HTMLDivElement | null>(null);
  const handleMuteClick = useCallback(() => {
    onMuteToggle(track.id);
  }, [onMuteToggle, track.id]);

  const handleSoloClick = useCallback(() => {
    onSoloToggle(track.id);
  }, [onSoloToggle, track.id]);

  const fallbackPercent = level
    ? getMeterFallbackPercent({
      unresolvedSourceCount: level.unresolvedSourceCount,
      resolvedSourceCount: level.resolvedSourceCount,
      isPlaying,
    })
    : 0;
  const leftPercent = isPlaying ? Math.max(level ? linearLevelToPercent(level.left) : 0, fallbackPercent) : 0;
  const rightPercent = isPlaying ? Math.max(level ? linearLevelToPercent(level.right) : 0, fallbackPercent) : 0;
  const showScanningFallback = fallbackPercent > 0;

  return (
    <div className="flex flex-col items-center h-full w-[44px] min-w-[44px] border-r border-border/40 px-0.5">
      {/* Track name */}
      <div
        className="w-full text-center text-[10px] uppercase tracking-wider text-muted-foreground/80 truncate px-0.5 py-1 leading-tight"
        title={track.name}
      >
        {track.name}
      </div>

      {/* Solo / Mute buttons */}
      <div className="flex gap-0.5 py-0.5 shrink-0">
        <button
          type="button"
          className={`w-4 h-4 rounded-[2px] text-[8px] font-bold leading-none flex items-center justify-center transition-colors ${
            track.solo
              ? 'bg-amber-500 text-black shadow-[0_0_6px_rgba(245,158,11,0.5)]'
              : 'bg-muted/50 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground'
          }`}
          onClick={handleSoloClick}
          aria-label={`Solo ${track.name}`}
          aria-pressed={track.solo}
        >
          S
        </button>
        <button
          type="button"
          className={`w-4 h-4 rounded-[2px] text-[8px] font-bold leading-none flex items-center justify-center transition-colors ${
            track.muted
              ? 'bg-red-600 text-white shadow-[0_0_6px_rgba(220,38,38,0.5)]'
              : 'bg-muted/50 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground'
          }`}
          onClick={handleMuteClick}
          aria-label={`Mute ${track.name}`}
          aria-pressed={track.muted}
        >
          M
        </button>
      </div>

      {/* Fader + mini level meter area */}
      <div className="flex-1 w-full min-h-0 flex items-stretch gap-px py-1">
        {/* Mini per-track level bars */}
        <div className="flex gap-px w-[8px] shrink-0">
          <div className="relative flex-1 rounded-[1px] bg-[#060708] overflow-hidden">
            <div
              data-track-id={track.id}
              data-track-channel="left"
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-60' : ''}`}
              style={{
                height: `${leftPercent}%`,
                transition: 'height 100ms ease-out',
              }}
            />
          </div>
          <div className="relative flex-1 rounded-[1px] bg-[#060708] overflow-hidden">
            <div
              data-track-id={track.id}
              data-track-channel="right"
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-60' : ''}`}
              style={{
                height: `${rightPercent}%`,
                transition: 'height 100ms ease-out',
              }}
            />
          </div>
        </div>

        {/* Fader */}
        <div className="flex-1 min-w-0">
          <ChannelFader
            trackId={track.id}
            volumeDb={track.volume}
            itemIds={track.itemIds}
            onVolumeChange={onVolumeChange}
            dbReadoutRef={dbReadoutRef}
          />
        </div>
      </div>

      {/* dB readout */}
      <div ref={dbReadoutRef} className="text-[10px] font-mono text-muted-foreground py-0.5 leading-none">
        {formatFaderDb(track.volume)}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Bus / master meter
// ---------------------------------------------------------------------------

interface BusMeterProps {
  masterEstimate: AudioMixerViewProps['masterEstimate'];
  isPlaying: boolean;
}

const BusMeter = memo(function BusMeter({ masterEstimate, isPlaying }: BusMeterProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Smooth the bus meter with CSS transitions rather than rAF
  const fallbackPercent = getMeterFallbackPercent({
    unresolvedSourceCount: masterEstimate.unresolvedSourceCount,
    resolvedSourceCount: masterEstimate.resolvedSourceCount,
    isPlaying,
  });
  const leftPercent = isPlaying ? Math.max(linearLevelToPercent(masterEstimate.left), fallbackPercent) : 0;
  const rightPercent = isPlaying ? Math.max(linearLevelToPercent(masterEstimate.right), fallbackPercent) : 0;
  const showScanningFallback = fallbackPercent > 0;

  // Use a ref to imperatively update for smoother animation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const leftBar = el.querySelector<HTMLDivElement>('[data-bus-channel="left"]');
    const rightBar = el.querySelector<HTMLDivElement>('[data-bus-channel="right"]');
    if (leftBar) leftBar.style.height = `${leftPercent}%`;
    if (rightBar) rightBar.style.height = `${rightPercent}%`;
  }, [leftPercent, rightPercent]);

  return (
    <div className="flex flex-col items-center h-full w-[40px] min-w-[40px] border-l border-border/60 px-1">
      {/* Label */}
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/80 py-1 leading-tight">
        Bus
      </div>

      {/* Spacer to align with S/M row */}
      <div className="h-[18px] shrink-0" />

      {/* Stereo meter bars */}
      <div ref={containerRef} className="flex-1 min-h-0 flex gap-0.5 py-1">
        <div className="relative w-[5px] rounded-sm border border-border/70 bg-[#111318] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-[1px] overflow-hidden rounded-[1px] bg-[#060708]">
            <div
              data-bus-channel="left"
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-60' : ''}`}
              style={{ height: '0%', transition: 'height 100ms ease-out' }}
            />
          </div>
        </div>
        <div className="relative w-[5px] rounded-sm border border-border/70 bg-[#111318] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-[1px] overflow-hidden rounded-[1px] bg-[#060708]">
            <div
              data-bus-channel="right"
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-60' : ''}`}
              style={{ height: '0%', transition: 'height 100ms ease-out' }}
            />
          </div>
        </div>
      </div>

      {/* L/R labels */}
      <div className="flex gap-0.5 text-[7px] font-mono text-muted-foreground/50 pb-0.5">
        <span className="w-[5px] text-center">L</span>
        <span className="w-[5px] text-center">R</span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Scale column (dB marks on the left side)
// ---------------------------------------------------------------------------

const ScaleColumn = memo(function ScaleColumn() {
  return (
    <div className="relative w-[24px] min-w-[24px] shrink-0">
      {/* Top label spacer */}
      <div className="h-[18px]" />
      {/* S/M spacer */}
      <div className="h-[18px]" />

      {/* Scale area */}
      <div className="relative flex-1" style={{ height: 'calc(100% - 54px)' }}>
        {FADER_SCALE_MARKS.map((mark) => {
          const percent = dbToFaderPercent(mark);
          return (
            <div
              key={mark}
              className="absolute right-0 -translate-y-1/2 text-[8px] font-mono text-muted-foreground/50 leading-none whitespace-nowrap"
              style={{ bottom: `${percent}%` }}
            >
              {mark}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main mixer view
// ---------------------------------------------------------------------------

export const AudioMixerView = memo(function AudioMixerView({
  tracks,
  perTrackLevels,
  masterEstimate,
  isPlaying,
  onTrackVolumeChange,
  onTrackMuteToggle,
  onTrackSoloToggle,
  headerExtra,
}: AudioMixerViewProps) {
  return (
    <aside
      className="panel-bg border-l border-border flex h-full flex-col overflow-hidden"
      style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineMixerWidth }}
      aria-label="Audio mixer"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-border bg-secondary/20 px-3"
        style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
      >
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Mixer
        </span>
        {headerExtra ?? (
          <span
            className={`h-2 w-2 rounded-full ${isPlaying ? 'bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.7)]' : 'bg-muted-foreground/30'}`}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Mixer body */}
      <div className="flex-1 min-h-0 flex px-0.5 py-1">
        {/* dB scale column */}
        <ScaleColumn />

        {/* Channel strips (scrollable) */}
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full">
            {tracks.map((track) => (
              <ChannelStrip
                key={track.id}
                track={track}
                level={perTrackLevels.get(track.id)}
                isPlaying={isPlaying}
                onVolumeChange={onTrackVolumeChange}
                onMuteToggle={onTrackMuteToggle}
                onSoloToggle={onTrackSoloToggle}
              />
            ))}

            {tracks.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/40">
                No audio tracks
              </div>
            )}
          </div>
        </div>

        {/* Bus / master strip */}
        <BusMeter masterEstimate={masterEstimate} isPlaying={isPlaying} />
      </div>
    </aside>
  );
});
