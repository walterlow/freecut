import { memo, useCallback, useEffect, useMemo, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { linearLevelToPercent, setLiveTrackVolumeOverride, clearLiveTrackVolumeOverride, setLiveBusVolumeOverride, clearLiveBusVolumeOverride } from './audio-meter-utils';
import { getMixerLiveGain, setMixerLiveGains } from '@/shared/state/mixer-live-gain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudioMixerTrack {
  id: string;
  name: string;
  kind?: 'video' | 'audio';
  color?: string;
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
  masterVolumeDb: number;
  masterMuted: boolean;
  onMasterVolumeChange: (volumeDb: number) => void;
  onMasterMuteToggle: () => void;
  onTrackVolumeChange: (trackId: string, volumeDb: number) => void;
  onTrackMuteToggle: (trackId: string) => void;
  onTrackSoloToggle: (trackId: string) => void;
  headerExtra?: ReactNode;
  /** Expanded layout for floating panel — wider strips, bigger meters */
  expanded?: boolean;
}

// ---------------------------------------------------------------------------
// dB <-> fader mapping
// ---------------------------------------------------------------------------

const FADER_DB_MIN = -60;
const FADER_DB_MAX = 12;
const FADER_DB_RANGE = FADER_DB_MAX - FADER_DB_MIN; // 72
const FADER_KNOB_HEIGHT_PX = 22;
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
// Segmented LED meter (shared between channel strips & bus)
// ---------------------------------------------------------------------------

// Segment dimensions: 3px tall segments with 1px gaps = 4px pitch.
// CSS mask-image creates the segmented look over the existing gradient fill.
// This keeps the same animation system (height %) while adding the hardware feel.
const SEGMENT_MASK = 'repeating-linear-gradient(to top, black 0px, black 3px, transparent 3px, transparent 4px)';
const UNLIT_LED_BG = 'repeating-linear-gradient(to top, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 3px, transparent 3px, transparent 4px)';

interface SegmentedMeterBarProps {
  /** CSS height value, e.g. "42%" */
  height: string;
  /** CSS bottom value for peak hold, e.g. "58%" */
  peakBottom?: string;
  /** Whether the source is still scanning (unresolved waveform) */
  scanning?: boolean;
  /** Additional className for the outer container */
  className?: string;
  /** Optional attributes for the active fill element */
  fillProps?: HTMLAttributes<HTMLDivElement>;
  /** Imperative ref used for smooth local meter preview during fader drag */
  fillRef?: RefObject<HTMLDivElement | null>;
}

const SegmentedMeterBar = memo(function SegmentedMeterBar({
  height,
  peakBottom,
  scanning,
  className = '',
  fillProps,
  fillRef,
}: SegmentedMeterBarProps) {
  return (
    <div className={`relative flex-1 rounded-[2px] bg-[#08090b] overflow-hidden ${className}`}>
      {/* Unlit LED backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: UNLIT_LED_BG }}
      />

      {/* Active fill — gradient with segment mask */}
      <div
        ref={fillRef}
        {...fillProps}
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${scanning ? 'opacity-50' : ''}`}
        style={{
          height,
          maskImage: SEGMENT_MASK,
          WebkitMaskImage: SEGMENT_MASK,
          transition: 'height 100ms ease-out',
        }}
      />

      {/* Peak hold — single bright segment */}
      {peakBottom != null && (
        <div
          className="absolute inset-x-0 h-[3px] rounded-[1px] bg-white/85 shadow-[0_0_4px_rgba(255,255,255,0.5)]"
          style={{
            bottom: peakBottom,
            maskImage: SEGMENT_MASK,
            WebkitMaskImage: SEGMENT_MASK,
            transition: 'bottom 100ms ease-out',
          }}
        />
      )}
    </div>
  );
});

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
  dbReadoutRef?: RefObject<HTMLDivElement | null>;
  /** Immediate visual preview for the per-track meter while graph estimates catch up */
  onMeterPreviewChange?: (previewDb: number | null) => void;
}

const ChannelFader = memo(function ChannelFader({
  trackId,
  volumeDb,
  itemIds,
  onVolumeChange,
  dbReadoutRef,
  onMeterPreviewChange,
}: ChannelFaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetPercentRef = useRef(0);
  const latestDbRef = useRef(volumeDb);
  const dragStartDbRef = useRef(volumeDb);
  const dragStartGainsRef = useRef<Map<string, number>>(new Map());
  const finalizeDragRef = useRef<(params?: {
    pointerId?: number;
    target?: Pick<HTMLDivElement, 'releasePointerCapture'> | null;
  }) => void>(() => {});

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
    const committedDb = dragStartDbRef.current;
    const gainRatio = Math.pow(10, (db - committedDb) / 20);
    setMixerLiveGains(itemIds.map((id) => ({
      itemId: id,
      gain: (dragStartGainsRef.current.get(id) ?? 1) * gainRatio,
    })));

    // Feed live volume into the meter source builder so both per-track
    // and bus meters update in real-time during drag.
    setLiveTrackVolumeOverride(trackId, db);
    onMeterPreviewChange?.(db);
  }, [dbReadoutRef, itemIds, onMeterPreviewChange, trackId, volumeDb]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      isDraggingRef.current = true;
      dragStartDbRef.current = latestDbRef.current;
      dragStartGainsRef.current = new Map(itemIds.map((id) => [id, getMixerLiveGain(id)]));
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

  const finalizeDrag = useCallback((params?: {
    pointerId?: number;
    target?: Pick<HTMLDivElement, 'releasePointerCapture'> | null;
  }) => {
    if (!isDraggingRef.current) {
      return;
    }

    const { pointerId, target } = params ?? {};
    isDraggingRef.current = false;
    dragOffsetPercentRef.current = 0;
    if (target && pointerId !== undefined) {
      target.releasePointerCapture?.(pointerId);
    }
    // Commit to store first so the graph recompiles with the new value,
    // then clear the live override so the next resolution uses the compiled value.
    onVolumeChange(trackId, latestDbRef.current);
    clearLiveTrackVolumeOverride(trackId);
    onMeterPreviewChange?.(null);
  }, [onMeterPreviewChange, onVolumeChange, trackId]);
  finalizeDragRef.current = finalizeDrag;

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      finalizeDrag({
        pointerId: e.pointerId,
        target: e.currentTarget,
      });
    },
    [finalizeDrag],
  );

  useEffect(() => {
    return () => {
      finalizeDragRef.current();
    };
  }, []);

  const handleDoubleClick = useCallback(() => {
    applyDragValue(0);
    onVolumeChange(trackId, 0);
    clearLiveTrackVolumeOverride(trackId);
  }, [applyDragValue, onVolumeChange, trackId]);

  const knobPercent = dbToFaderPercent(volumeDb);
  const unityPercent = dbToFaderPercent(0);

  return (
    <div
      ref={trackRef}
      data-track-id={trackId}
      data-fader-root="true"
      className="relative h-full cursor-ns-resize select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Fader track line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-border/70" />

      {/* Unity (0 dB) notch — small horizontal ticks */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center"
        style={{ bottom: `${unityPercent}%`, transform: 'translateY(50%)' }}
      >
        <div className="w-full h-px bg-muted-foreground/25" />
      </div>

      {/* Fader knob — capsule shape */}
      <div
        ref={knobRef}
        data-track-id={trackId}
        data-fader-knob="true"
        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          top: `${100 - knobPercent}%`,
          width: '18px',
          height: `${FADER_KNOB_HEIGHT_PX}px`,
        }}
      >
        {/* Knob body */}
        <div className="w-full h-full rounded-[4px] bg-gradient-to-b from-zinc-300 to-zinc-400 shadow-[0_1px_4px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.3)] border border-zinc-500/40">
          {/* Grip lines */}
          <div className="absolute inset-x-[3px] top-[7px] h-px bg-zinc-600/50" />
          <div className="absolute inset-x-[3px] top-[10px] h-px bg-zinc-600/50" />
          <div className="absolute inset-x-[3px] top-[13px] h-px bg-zinc-600/50" />
          {/* Center notch — unity indicator */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-zinc-600/30 rounded-full mx-[2px]" />
        </div>
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
  expanded?: boolean;
  onVolumeChange: (trackId: string, volumeDb: number) => void;
  onMuteToggle: (trackId: string) => void;
  onSoloToggle: (trackId: string) => void;
}

const ChannelStrip = memo(function ChannelStrip({
  track,
  level,
  isPlaying,
  expanded,
  onVolumeChange,
  onMuteToggle,
  onSoloToggle,
}: ChannelStripProps) {
  const dbReadoutRef = useRef<HTMLDivElement | null>(null);
  const leftBarRef = useRef<HTMLDivElement | null>(null);
  const rightBarRef = useRef<HTMLDivElement | null>(null);
  const leftPercentRef = useRef(0);
  const rightPercentRef = useRef(0);
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
  leftPercentRef.current = leftPercent;
  rightPercentRef.current = rightPercent;

  const syncMeterBars = useCallback(() => {
    if (!leftBarRef.current || !rightBarRef.current) return;
    leftBarRef.current.style.height = `${leftPercentRef.current}%`;
    rightBarRef.current.style.height = `${rightPercentRef.current}%`;
  }, []);

  useEffect(() => {
    syncMeterBars();
  }, [syncMeterBars, leftPercent, rightPercent]);

  // dB readout color: green at unity, amber when boosted, dim when cut
  const dbColor = track.volume > 0.05
    ? 'text-amber-400/90'
    : track.volume > -0.05
      ? 'text-emerald-400/80'
      : 'text-muted-foreground/60';

  const stripWidth = expanded ? 'min-w-[68px] w-[68px]' : 'min-w-[52px] w-[52px]';
  const meterBarWidth = expanded ? 'w-[14px]' : 'w-[14px]';
  const meterBarGap = 'gap-[2px]';
  const buttonSize = expanded ? 'w-[22px] h-[18px] text-[10px]' : 'w-[18px] h-[16px] text-[9px]';

  return (
    <div className={`flex h-full ${stripWidth}`}>
      {/* Track color stripe — doubles as channel divider */}
      <div
        className="w-[2px] shrink-0"
        style={{ backgroundColor: track.color || 'var(--border)' }}
      />

      {/* Strip body */}
      <div className={`flex flex-1 flex-col items-center ${expanded ? 'px-1' : 'px-0.5'}`}>
        {/* Track name */}
        <div
          className={`w-full text-center uppercase tracking-wider text-muted-foreground/80 truncate px-0.5 py-1 leading-tight ${expanded ? 'text-[11px]' : 'text-[10px]'}`}
          title={track.name}
        >
          {track.name}
        </div>

        {/* Solo / Mute buttons */}
        <div className={`flex ${expanded ? 'gap-1' : 'gap-0.5'} py-0.5 shrink-0`}>
          <button
            type="button"
            className={`${buttonSize} rounded-[3px] font-bold leading-none flex items-center justify-center transition-colors ${
              track.solo
                ? 'bg-amber-500 text-black shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                : 'bg-muted/40 text-muted-foreground/40 hover:bg-muted/70 hover:text-muted-foreground/70'
            }`}
            onClick={handleSoloClick}
            aria-label={`Solo ${track.name}`}
            aria-pressed={track.solo}
          >
            S
          </button>
          <button
            type="button"
            className={`${buttonSize} rounded-[3px] font-bold leading-none flex items-center justify-center transition-colors ${
              track.muted
                ? 'bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.4)]'
                : 'bg-muted/40 text-muted-foreground/40 hover:bg-muted/70 hover:text-muted-foreground/70'
            }`}
            onClick={handleMuteClick}
            aria-label={`Mute ${track.name}`}
            aria-pressed={track.muted}
          >
            M
          </button>
        </div>

        {/* Fader + segmented level meter area */}
        <div className={`flex-1 w-full min-h-0 flex items-stretch ${expanded ? 'gap-0.5' : 'gap-px'} py-1`}>
          {/* Segmented per-track level bars */}
          <div className={`flex ${meterBarGap} ${meterBarWidth} shrink-0`}>
            <SegmentedMeterBar
              height="0%"
              scanning={showScanningFallback}
              fillRef={leftBarRef}
              fillProps={{
                'data-track-id': track.id,
                'data-track-channel': 'left',
              }}
            />
            <SegmentedMeterBar
              height="0%"
              scanning={showScanningFallback}
              fillRef={rightBarRef}
              fillProps={{
                'data-track-id': track.id,
                'data-track-channel': 'right',
              }}
            />
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

        {/* dB readout — color-coded */}
        <div ref={dbReadoutRef} className={`text-[10px] font-mono py-0.5 leading-none ${dbColor}`}>
          {formatFaderDb(track.volume)}
        </div>
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
  volumeDb: number;
  muted: boolean;
  allItemIds: string[];
  onVolumeChange: (volumeDb: number) => void;
  onMuteToggle: () => void;
}

const BusMeter = memo(function BusMeter({ masterEstimate, isPlaying, volumeDb, muted, allItemIds, onVolumeChange, onMuteToggle }: BusMeterProps) {
  const leftBarRef = useRef<HTMLDivElement | null>(null);
  const rightBarRef = useRef<HTMLDivElement | null>(null);
  const dbReadoutRef = useRef<HTMLDivElement | null>(null);

  // Bus fader state
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetPercentRef = useRef(0);
  const latestDbRef = useRef(volumeDb);
  const dragStartDbRef = useRef(volumeDb);
  const dragStartGainsRef = useRef<Map<string, number>>(new Map());

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
    if (!pointerIsNearKnob) return 0;
    return currentPercent - ((pointerYFromBottom / rect.height) * 100);
  }, []);

  const applyBusDragValue = useCallback((db: number) => {
    latestDbRef.current = db;
    if (knobRef.current) {
      knobRef.current.style.top = `${100 - dbToFaderPercent(db)}%`;
    }
    if (dbReadoutRef.current) {
      dbReadoutRef.current.textContent = formatFaderDb(db);
      dbReadoutRef.current.className = `text-[10px] font-mono py-0.5 leading-none ${
        db > 0.05 ? 'text-amber-400/90' : db > -0.05 ? 'text-emerald-400/80' : 'text-muted-foreground/60'
      }`;
    }
    // Apply live gain to all items (bus = master gain offset)
    const committedDb = dragStartDbRef.current;
    const gainRatio = Math.pow(10, (db - committedDb) / 20);
    setMixerLiveGains(allItemIds.map((id) => ({
      itemId: id,
      gain: (dragStartGainsRef.current.get(id) ?? 1) * gainRatio,
    })));
    setLiveBusVolumeOverride(db);
  }, [allItemIds]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    isDraggingRef.current = true;
    dragStartDbRef.current = latestDbRef.current;
    dragStartGainsRef.current = new Map(allItemIds.map((id) => [id, getMixerLiveGain(id)]));
    dragOffsetPercentRef.current = dragOffsetPercentFromPointerEvent(e.nativeEvent);
    const percent = percentFromPointerEvent(e.nativeEvent);
    const adjustedPercent = Math.max(0, Math.min(100, percent + dragOffsetPercentRef.current));
    applyBusDragValue(Math.round(faderPercentToDb(adjustedPercent) * 10) / 10);
  }, [allItemIds, applyBusDragValue, dragOffsetPercentFromPointerEvent, percentFromPointerEvent]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const percent = percentFromPointerEvent(e.nativeEvent);
    const adjustedPercent = Math.max(0, Math.min(100, percent + dragOffsetPercentRef.current));
    applyBusDragValue(Math.round(faderPercentToDb(adjustedPercent) * 10) / 10);
  }, [applyBusDragValue, percentFromPointerEvent]);

  const finalizeBusDrag = useCallback((params?: {
    pointerId?: number;
    target?: Pick<HTMLDivElement, 'releasePointerCapture'> | null;
  }) => {
    if (!isDraggingRef.current) return;
    const { pointerId, target } = params ?? {};
    isDraggingRef.current = false;
    dragOffsetPercentRef.current = 0;
    if (target && pointerId !== undefined) {
      target.releasePointerCapture?.(pointerId);
    }
    onVolumeChange(latestDbRef.current);
    clearLiveBusVolumeOverride();
  }, [onVolumeChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    finalizeBusDrag({ pointerId: e.pointerId, target: e.currentTarget });
  }, [finalizeBusDrag]);

  useEffect(() => {
    return () => { finalizeBusDrag(); };
  }, [finalizeBusDrag]);

  const handleDoubleClick = useCallback(() => {
    applyBusDragValue(0);
    onVolumeChange(0);
    clearLiveBusVolumeOverride();
  }, [applyBusDragValue, onVolumeChange]);

  // Smooth the bus meter with CSS transitions rather than rAF
  const fallbackPercent = getMeterFallbackPercent({
    unresolvedSourceCount: masterEstimate.unresolvedSourceCount,
    resolvedSourceCount: masterEstimate.resolvedSourceCount,
    isPlaying,
  });
  const leftPercent = isPlaying ? Math.max(linearLevelToPercent(masterEstimate.left), fallbackPercent) : 0;
  const rightPercent = isPlaying ? Math.max(linearLevelToPercent(masterEstimate.right), fallbackPercent) : 0;
  const showScanningFallback = fallbackPercent > 0;

  // Use refs to imperatively update for smoother animation
  useEffect(() => {
    if (leftBarRef.current) leftBarRef.current.style.height = `${leftPercent}%`;
    if (rightBarRef.current) rightBarRef.current.style.height = `${rightPercent}%`;
  }, [leftPercent, rightPercent]);

  const knobPercent = dbToFaderPercent(volumeDb);
  const unityPercent = dbToFaderPercent(0);
  const dbColor = volumeDb > 0.05
    ? 'text-amber-400/90'
    : volumeDb > -0.05
      ? 'text-emerald-400/80'
      : 'text-muted-foreground/60';

  return (
    <div className="flex flex-col items-center h-full w-[60px] min-w-[60px] shrink-0">
      {/* Inset panel */}
      <div className="flex flex-col items-center h-full w-full rounded-[3px] bg-black/30 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] border border-border/20 px-1">
        {/* Label */}
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 py-1 leading-tight font-mono whitespace-nowrap">
          Bus 1
        </div>

        {/* Mute button — aligned with S/M row */}
        <div className="flex justify-center py-0.5 shrink-0">
          <button
            type="button"
            className={`w-[18px] h-[16px] rounded-[3px] text-[9px] font-bold leading-none flex items-center justify-center transition-colors ${
              muted
                ? 'bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.4)]'
                : 'bg-muted/40 text-muted-foreground/40 hover:bg-muted/70 hover:text-muted-foreground/70'
            }`}
            onClick={onMuteToggle}
            aria-label="Mute master"
            aria-pressed={muted}
          >
            M
          </button>
        </div>

        {/* Meter bars + fader area */}
        <div className="flex-1 min-h-0 flex items-stretch gap-px py-1">
          {/* Stereo segmented meter bars */}
          <div className="flex gap-[2px] w-[14px] shrink-0">
            <div className="relative flex-1 rounded-[2px] bg-[#08090b] overflow-hidden">
              {/* Unlit LED backdrop */}
              <div className="absolute inset-0 pointer-events-none" style={{ background: UNLIT_LED_BG }} />
              {/* Active fill */}
              <div
                ref={leftBarRef}
                data-bus-channel="left"
                className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-50' : ''}`}
                style={{
                  height: '0%',
                  maskImage: SEGMENT_MASK,
                  WebkitMaskImage: SEGMENT_MASK,
                  transition: 'height 100ms ease-out',
                }}
              />
            </div>
            <div className="relative flex-1 rounded-[2px] bg-[#08090b] overflow-hidden">
              {/* Unlit LED backdrop */}
              <div className="absolute inset-0 pointer-events-none" style={{ background: UNLIT_LED_BG }} />
              {/* Active fill */}
              <div
                ref={rightBarRef}
                data-bus-channel="right"
                className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] ${showScanningFallback ? 'opacity-50' : ''}`}
                style={{
                  height: '0%',
                  maskImage: SEGMENT_MASK,
                  WebkitMaskImage: SEGMENT_MASK,
                  transition: 'height 100ms ease-out',
                }}
              />
            </div>
          </div>

          {/* Bus fader — same hit area structure as channel faders */}
          <div className="min-w-[20px] w-[20px] shrink-0">
            <div
              ref={trackRef}
              data-fader-root="true"
              className="relative h-full cursor-ns-resize select-none touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                if (!isDraggingRef.current) return;
                isDraggingRef.current = false;
                dragOffsetPercentRef.current = 0;
                applyBusDragValue(volumeDb);
                clearLiveBusVolumeOverride();
              }}
              onDoubleClick={handleDoubleClick}
            >
              {/* Fader track line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-border/70" />

              {/* Unity (0 dB) notch */}
              <div
                className="absolute left-0 right-0 flex items-center justify-center"
                style={{ bottom: `${unityPercent}%`, transform: 'translateY(50%)' }}
              >
                <div className="w-full h-px bg-muted-foreground/25" />
              </div>

              {/* Fader knob — gold tint to distinguish from channel faders */}
              <div
                ref={knobRef}
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  top: `${100 - knobPercent}%`,
                  width: '18px',
                  height: `${FADER_KNOB_HEIGHT_PX}px`,
                }}
              >
                <div className="w-full h-full rounded-[4px] bg-gradient-to-b from-[#d4c9a8] to-[#b8ad8e] shadow-[0_1px_4px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.25)] border border-[#9a9076]/50">
                  <div className="absolute inset-x-[3px] top-[7px] h-px bg-[#6b6350]/45" />
                  <div className="absolute inset-x-[3px] top-[10px] h-px bg-[#6b6350]/45" />
                  <div className="absolute inset-x-[3px] top-[13px] h-px bg-[#6b6350]/45" />
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#6b6350]/25 rounded-full mx-[2px]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* dB readout */}
        <div ref={dbReadoutRef} className={`text-[10px] font-mono py-0.5 leading-none ${dbColor}`}>
          {formatFaderDb(volumeDb)}
        </div>
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
              className="absolute right-0 -translate-y-1/2 text-[9px] font-mono text-muted-foreground/70 leading-none whitespace-nowrap"
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
  masterVolumeDb,
  masterMuted,
  onMasterVolumeChange,
  onMasterMuteToggle,
  onTrackVolumeChange,
  onTrackMuteToggle,
  onTrackSoloToggle,
  headerExtra,
  expanded,
}: AudioMixerViewProps) {
  // When expanded (floating), fill the panel; when docked, size to content
  const outerClassName = expanded
    ? 'panel-bg flex h-full flex-col overflow-hidden'
    : 'panel-bg border-l border-border flex h-full flex-col overflow-hidden w-fit';

  const allItemIds = useMemo(
    () => tracks.flatMap((track) => track.itemIds),
    [tracks],
  );

  return (
    <aside
      className={outerClassName}
      aria-label="Audio mixer"
    >
      {/* Header — only shown when docked (floating panel has its own title bar) */}
      {!expanded && (
        <div
          className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-secondary/20 px-2"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
        >
          <span className="min-w-0 text-xs text-muted-foreground font-mono uppercase tracking-[0.18em]">
            Mixer
          </span>
          {headerExtra ?? (
            <span
              className={`h-2 w-2 rounded-full ${isPlaying ? 'bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.7)]' : 'bg-muted-foreground/30'}`}
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {/* Mixer body */}
      <div className={`flex-1 min-h-0 flex ${expanded ? 'px-1 py-1.5' : 'px-0.5 py-1'} gap-0.5`}>
        {/* dB scale column */}
        <ScaleColumn />

        {/* Channel strips (scrollable) */}
        <div className={`${expanded ? 'flex-1' : ''} min-w-0 overflow-x-auto overflow-y-hidden`}>
          <div className="flex h-full">
            {tracks.map((track) => (
              <ChannelStrip
                key={track.id}
                track={track}
                level={perTrackLevels.get(track.id)}
                isPlaying={isPlaying}
                expanded={expanded}
                onVolumeChange={onTrackVolumeChange}
                onMuteToggle={onTrackMuteToggle}
                onSoloToggle={onTrackSoloToggle}
              />
            ))}

            {/* Trailing border after last strip */}
            {tracks.length > 0 && (
              <div className="w-[2px] shrink-0 bg-border/40" />
            )}

            {tracks.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/30 italic">
                No audio tracks
              </div>
            )}
          </div>
        </div>

        {/* Bus / master strip */}
        <BusMeter masterEstimate={masterEstimate} isPlaying={isPlaying} volumeDb={masterVolumeDb} muted={masterMuted} allItemIds={allItemIds} onVolumeChange={onMasterVolumeChange} onMuteToggle={onMasterMuteToggle} />
      </div>
    </aside>
  );
});
