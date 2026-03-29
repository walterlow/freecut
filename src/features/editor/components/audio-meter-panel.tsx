import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore, useItemsStore, useCompositionsStore, importWaveformCache } from '@/features/editor/deps/timeline-store';
import { importMediaLibraryService } from '@/features/editor/deps/media-library';
import { usePlaybackStore } from '@/shared/state/playback';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import {
  AUDIO_METER_SCALE_MARKS,
  compileAudioMeterGraph,
  dbMarkToPercent,
  estimateAudioMeterLevel,
  estimatePerTrackLevels,
  formatMeterDb,
  isAudioMixerTrack,
  linearLevelToPercent,
  resolveCompiledAudioMeterSources,
  type AudioMeterCompositionLookup,
  type AudioMeterEstimate,
  type AudioMeterWaveform,
} from './audio-meter-utils';
import { AudioMixerView, type AudioMixerTrack } from './audio-mixer-view';

type PanelMode = 'meter' | 'mixer';

function toWaveformSnapshot(
  waveform: { peaks: Float32Array; sampleRate: number; channels?: number; stereo?: boolean } | null | undefined,
): AudioMeterWaveform | null {
  if (!waveform) {
    return null;
  }

  return {
    peaks: waveform.peaks,
    sampleRate: waveform.sampleRate,
    channels: waveform.stereo ? 2 : (waveform.channels ?? 1),
  };
}

function animateChannel(
  channel: { displayPercent: number; peakPercent: number; peakHoldSeconds: number },
  targetPercent: number,
  deltaSeconds: number,
): void {
  if (targetPercent >= channel.displayPercent) {
    const attackFactor = 1 - Math.exp(-28 * deltaSeconds);
    channel.displayPercent += (targetPercent - channel.displayPercent) * attackFactor;
  } else {
    channel.displayPercent = Math.max(targetPercent, channel.displayPercent - (76 * deltaSeconds));
  }

  if (channel.displayPercent >= channel.peakPercent) {
    channel.peakPercent = channel.displayPercent;
    channel.peakHoldSeconds = 0.22;
  } else if (channel.peakHoldSeconds > 0) {
    channel.peakHoldSeconds = Math.max(0, channel.peakHoldSeconds - deltaSeconds);
  } else {
    channel.peakPercent = Math.max(channel.displayPercent, channel.peakPercent - (54 * deltaSeconds));
  }
}

const EMPTY_PER_TRACK_LEVELS = new Map<string, AudioMeterEstimate>();

export const AudioMeterPanel = memo(function AudioMeterPanel() {
  const [panelMode, setPanelMode] = useState<PanelMode>('meter');

  const tracks = useTimelineStore((s) => s.tracks);
  const transitions = useTimelineStore((s) => s.transitions);
  const fps = useTimelineStore((s) => s.fps);
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId);
  const compositions = useCompositionsStore((s) => s.compositions);

  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const displayedFrame = usePlaybackStore((s) => s.displayedFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const volume = usePlaybackStore((s) => s.volume);
  const muted = usePlaybackStore((s) => s.muted);

  const [waveformsByMediaId, setWaveformsByMediaId] = useState<Map<string, AudioMeterWaveform | null>>(new Map());
  const meterVisualRootRef = useRef<HTMLDivElement | null>(null);
  const targetPercentRef = useRef({ left: 0, right: 0 });
  const isPlayingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const meterAnimationRef = useRef({
    left: { displayPercent: 0, peakPercent: 0, peakHoldSeconds: 0 },
    right: { displayPercent: 0, peakPercent: 0, peakHoldSeconds: 0 },
    lastTimestamp: 0,
  });

  const effectiveFrame = previewFrame ?? displayedFrame ?? currentFrame;
  const playbackGain = isPlaying && !muted ? volume : 0;
  const combinedTracks = useMemo(() => {
    return tracks
      .filter((track) => !track.isGroup)
      .map((track) => ({
        ...track,
        items: itemsByTrackId[track.id] ?? [],
      }));
  }, [itemsByTrackId, tracks]);
  const combinedCompositionsById = useMemo<AudioMeterCompositionLookup>(() => {
    const next: AudioMeterCompositionLookup = {};

    for (const composition of compositions) {
      const compositionItemsByTrackId: Record<string, typeof composition.items> = {};
      for (const item of composition.items) {
        (compositionItemsByTrackId[item.trackId] ??= []).push(item);
      }

      next[composition.id] = {
        id: composition.id,
        fps: composition.fps,
        transitions: composition.transitions ?? [],
        tracks: composition.tracks
          .filter((track) => !track.isGroup)
          .map((track) => ({
            ...track,
            items: compositionItemsByTrackId[track.id] ?? [],
          })),
      };
    }

    return next;
  }, [compositions]);

  const compiledGraph = useMemo(() => compileAudioMeterGraph({
    tracks: combinedTracks,
    transitions,
    fps,
    compositionsById: combinedCompositionsById,
  }), [combinedCompositionsById, combinedTracks, fps, transitions]);

  const preloadSources = useMemo(() => {
    return resolveCompiledAudioMeterSources({
      graph: compiledGraph,
      frame: effectiveFrame,
      masterGain: 1,
    });
  }, [compiledGraph, effectiveFrame]);

  const sources = useMemo(() => {
    if (playbackGain <= 0.0001) {
      return [];
    }

    return preloadSources.map((source) => ({
      ...source,
      gain: source.gain * playbackGain,
    }));
  }, [playbackGain, preloadSources]);

  const activeMediaIds = useMemo(() => {
    return [...new Set(preloadSources.map((source) => source.mediaId))].sort();
  }, [preloadSources]);
  const activeMediaIdsKey = activeMediaIds.join('|');
  const stableActiveMediaIds = useMemo(() => activeMediaIds, [activeMediaIdsKey]);

  useEffect(() => {
    if (stableActiveMediaIds.length === 0) {
      setWaveformsByMediaId(new Map());
      return;
    }

    let cancelled = false;
    const unsubscribeFns: Array<() => void> = [];

    void Promise.all([
      importWaveformCache(),
      importMediaLibraryService(),
    ]).then(([waveformModule, mediaLibraryModule]) => {
      if (cancelled) {
        return;
      }

      const { waveformCache } = waveformModule;
      const { mediaLibraryService } = mediaLibraryModule;

      setWaveformsByMediaId(() => {
        const next = new Map<string, AudioMeterWaveform | null>();
        for (const mediaId of stableActiveMediaIds) {
          next.set(mediaId, toWaveformSnapshot(waveformCache.getFromMemoryCacheSync(mediaId)));
        }
        return next;
      });

      for (const mediaId of stableActiveMediaIds) {
        unsubscribeFns.push(waveformCache.subscribe(mediaId, (updated) => {
          if (cancelled) {
            return;
          }

          setWaveformsByMediaId((previous) => {
            const next = new Map(previous);
            next.set(mediaId, toWaveformSnapshot(updated));
            return next;
          });
        }));

        const cached = waveformCache.getFromMemoryCacheSync(mediaId);
        if (cached?.isComplete) {
          continue;
        }

        void mediaLibraryService.getMediaBlobUrl(mediaId)
          .then(async (blobUrl) => {
            if (!blobUrl) {
              return;
            }

            try {
              await waveformCache.getWaveform(mediaId, blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          })
          .catch(() => {
            // Best-effort meter loading only.
          });
      }
    });

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribeFns) {
        unsubscribe();
      }
    };
  }, [stableActiveMediaIds]);

  const estimate = useMemo(() => {
    return estimateAudioMeterLevel({
      sources,
      waveformsByMediaId,
    });
  }, [sources, waveformsByMediaId]);
  const maxLevel = Math.max(estimate.left, estimate.right);
  const statusLabel = !isPlaying
    ? 'Idle'
    : estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0
      ? 'Scanning'
      : formatMeterDb(maxLevel);
  const scanFallbackPercent = isPlaying && estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0
    ? 18
    : 0;

  // ---------------------------------------------------------------------------
  // Meter animation (only active in meter mode, but state kept alive)
  // ---------------------------------------------------------------------------

  const applyMeterVisuals = useCallback((leftDisplay: number, leftPeak: number, rightDisplay: number, rightPeak: number) => {
    if (meterVisualRootRef.current) {
      const el = meterVisualRootRef.current;
      el.style.setProperty('--meter-l', `${leftDisplay}%`);
      el.style.setProperty('--meter-l-peak', `${leftPeak}%`);
      el.style.setProperty('--meter-r', `${rightDisplay}%`);
      el.style.setProperty('--meter-r-peak', `${rightPeak}%`);
    }
  }, []);

  const runMeterAnimation = useRef<(timestamp: number) => void>(() => {});
  runMeterAnimation.current = (timestamp: number) => {
    const state = meterAnimationRef.current;
    const deltaSeconds = state.lastTimestamp > 0
      ? Math.min(0.05, (timestamp - state.lastTimestamp) / 1000)
      : (1 / 60);
    state.lastTimestamp = timestamp;

    const { left: targetLeft, right: targetRight } = targetPercentRef.current;
    animateChannel(state.left, targetLeft, deltaSeconds);
    animateChannel(state.right, targetRight, deltaSeconds);

    applyMeterVisuals(
      state.left.displayPercent,
      state.left.peakPercent,
      state.right.displayPercent,
      state.right.peakPercent,
    );

    const shouldContinue = isPlayingRef.current
      || targetLeft > 0.1 || targetRight > 0.1
      || state.left.displayPercent > 0.1 || state.right.displayPercent > 0.1
      || state.left.peakPercent > 0.1 || state.right.peakPercent > 0.1;

    if (shouldContinue) {
      animationFrameRef.current = requestAnimationFrame(runMeterAnimation.current);
      return;
    }

    animationFrameRef.current = null;
    state.lastTimestamp = 0;
  };

  const ensureMeterAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return;
    }
    animationFrameRef.current = requestAnimationFrame(runMeterAnimation.current);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    targetPercentRef.current = {
      left: Math.max(linearLevelToPercent(estimate.left), scanFallbackPercent),
      right: Math.max(linearLevelToPercent(estimate.right), scanFallbackPercent),
    };
    ensureMeterAnimation();
  }, [ensureMeterAnimation, estimate.left, estimate.right, isPlaying, scanFallbackPercent]);

  useEffect(() => {
    applyMeterVisuals(0, 0, 0, 0);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      const anim = meterAnimationRef.current;
      anim.left.displayPercent = 0; anim.left.peakPercent = 0; anim.left.peakHoldSeconds = 0;
      anim.right.displayPercent = 0; anim.right.peakPercent = 0; anim.right.peakHoldSeconds = 0;
      anim.lastTimestamp = 0;
    };
  }, [applyMeterVisuals]);

  // ---------------------------------------------------------------------------
  // Mixer-mode data
  // ---------------------------------------------------------------------------

  const mixerSourceTracks = useMemo(() => {
    if (panelMode !== 'mixer') return [];
    return combinedTracks.filter((track) => isAudioMixerTrack(track));
  }, [combinedTracks, panelMode]);

  const mixerTracks = useMemo<AudioMixerTrack[]>(() => {
    return mixerSourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      muted: track.muted,
      solo: track.solo,
      volume: track.volume || 0,
      itemIds: track.items.map((item) => item.id),
    }));
  }, [mixerSourceTracks]);

  const perTrackLevels = useMemo(() => {
    if (panelMode !== 'mixer' || playbackGain <= 0.0001) return EMPTY_PER_TRACK_LEVELS;
    return estimatePerTrackLevels({
      tracks: combinedTracks,
      sources,
      waveformsByMediaId,
      targetTrackIds: mixerSourceTracks.map((track) => track.id),
    });
  }, [combinedTracks, mixerSourceTracks, panelMode, playbackGain, sources, waveformsByMediaId]);

  // Called once on fader release — zero store writes during drag
  const handleTrackVolumeChange = useCallback((trackId: string, volumeDb: number) => {
    if (!Number.isFinite(volumeDb)) return;
    const currentTracks = useItemsStore.getState().tracks;
    useItemsStore.getState().setTracks(
      currentTracks.map((track) =>
        track.id === trackId
          ? { ...track, volume: volumeDb }
          // Sanitize NaN volumes on other tracks (legacy project data)
          : Number.isFinite(track.volume) ? track : { ...track, volume: 0 }
      ),
    );
    useTimelineStore.getState().markDirty();
  }, []);

  const handleTrackMuteToggle = useCallback((trackId: string) => {
    const currentTracks = useTimelineStore.getState().tracks;
    const track = currentTracks.find((t) => t.id === trackId);
    if (!track) return;
    useTimelineStore.getState().setTracks(
      currentTracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted } : t
      ),
    );
  }, []);

  const handleTrackSoloToggle = useCallback((trackId: string) => {
    const currentTracks = useTimelineStore.getState().tracks;
    const track = currentTracks.find((t) => t.id === trackId);
    if (!track) return;
    useTimelineStore.getState().setTracks(
      currentTracks.map((t) =>
        t.id === trackId ? { ...t, solo: !t.solo } : t
      ),
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Mode dropdown (shared across both views)
  // ---------------------------------------------------------------------------

  const modeDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          aria-label="Panel mode"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        <DropdownMenuItem onClick={() => setPanelMode('meter')}>
          <span className="w-4 inline-block">{panelMode === 'meter' ? '✓' : ''}</span>
          Meters
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPanelMode('mixer')}>
          <span className="w-4 inline-block">{panelMode === 'mixer' ? '✓' : ''}</span>
          Mixer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ---------------------------------------------------------------------------
  // Mixer mode
  // ---------------------------------------------------------------------------

  if (panelMode === 'mixer') {
    return (
      <AudioMixerView
        tracks={mixerTracks}
        perTrackLevels={perTrackLevels}
        masterEstimate={estimate}
        isPlaying={isPlaying}
        onTrackVolumeChange={handleTrackVolumeChange}
        onTrackMuteToggle={handleTrackMuteToggle}
        onTrackSoloToggle={handleTrackSoloToggle}
        headerExtra={modeDropdown}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Meter mode (default)
  // ---------------------------------------------------------------------------

  return (
    <aside
      className="panel-bg border-l border-border flex h-full flex-col overflow-hidden"
      style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineMeterWidth }}
      aria-label="Audio meter"
    >
      <div
        className="flex items-center justify-between border-b border-border bg-secondary/20 px-3"
        style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
      >
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Meters
        </span>
        {modeDropdown}
      </div>

      <div className="flex-1 px-2 py-3 min-h-0">
        <div className="h-full rounded-md border border-border/70 bg-black/30 px-2 py-3 shadow-inner">
          <div className="mb-3 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
            Master
          </div>

          <div className="flex h-[calc(100%-2.75rem)] items-stretch gap-2">
            <div className="relative flex-1 min-w-0">
              {AUDIO_METER_SCALE_MARKS.map((mark) => {
                const bottom = `${dbMarkToPercent(mark)}%`;
                return (
                  <div key={mark} className="absolute inset-x-0" style={{ bottom }}>
                    <div className="absolute left-0 right-4 h-px bg-border/40" />
                    <span className="absolute right-0 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/70">
                      {mark}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col items-center">
              <div ref={meterVisualRootRef} className="flex flex-1 gap-0.5">
                {/* Left channel */}
                <div className="relative w-[10px] rounded-sm border border-border/70 bg-[#111318] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
                  <div className="absolute inset-[2px] overflow-hidden rounded-[2px] bg-[#060708]">
                    <div
                      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] transition-[height] duration-75 ease-out ${estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0 ? 'opacity-60' : ''}`}
                      style={{ height: 'var(--meter-l, 0%)' }}
                    />
                    <div
                      className="absolute inset-x-0 h-px bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.65)] transition-[bottom] duration-100 ease-out"
                      style={{ bottom: 'calc(var(--meter-l-peak, 0%) - 0.5px)' }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,transparent_0%,transparent_70%,rgba(255,255,255,0.08)_100%)]" />
                  </div>
                </div>
                {/* Right channel */}
                <div className="relative w-[10px] rounded-sm border border-border/70 bg-[#111318] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
                  <div className="absolute inset-[2px] overflow-hidden rounded-[2px] bg-[#060708]">
                    <div
                      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] transition-[height] duration-75 ease-out ${estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0 ? 'opacity-60' : ''}`}
                      style={{ height: 'var(--meter-r, 0%)' }}
                    />
                    <div
                      className="absolute inset-x-0 h-px bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.65)] transition-[bottom] duration-100 ease-out"
                      style={{ bottom: 'calc(var(--meter-r-peak, 0%) - 0.5px)' }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,transparent_0%,transparent_70%,rgba(255,255,255,0.08)_100%)]" />
                  </div>
                </div>
              </div>
              <div className="mt-1 flex gap-0.5 text-[8px] font-mono text-muted-foreground/50 justify-center">
                <span className="w-[10px] text-center">L</span>
                <span className="w-[10px] text-center">R</span>
              </div>
            </div>
          </div>

          <div className="mt-3 text-center text-[10px] font-mono text-muted-foreground">
            {statusLabel}
          </div>
        </div>
      </div>
    </aside>
  );
});
