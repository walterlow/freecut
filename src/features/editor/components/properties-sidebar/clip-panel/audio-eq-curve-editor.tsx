import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/shared/ui/cn';
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  getAudioEqSettings,
  resolveAudioEqSettings,
  sampleAudioEqResponseCurve,
  type AudioEqFieldSource,
} from '@/shared/utils/audio-eq';
import type { ResolvedAudioEqSettings } from '@/types/audio';

export type AudioEqPatch = Partial<AudioEqFieldSource>;

interface AudioEqCurveEditorProps {
  settings: ResolvedAudioEqSettings;
  disabled?: boolean;
  className?: string;
  graphClassName?: string;
  onLiveChange: (patch: AudioEqPatch) => void;
  onChange: (patch: AudioEqPatch) => void;
}

interface GainHandleDefinition {
  id: 'low' | 'low-mid' | 'high-mid' | 'high';
  kind: 'gain';
  label: string;
  bandNumber: 1 | 2 | 3 | 4 | 5 | 6;
  description: string;
  frequencyField?:
    | 'audioEqLowFrequencyHz'
    | 'audioEqLowMidFrequencyHz'
    | 'audioEqHighMidFrequencyHz'
    | 'audioEqHighFrequencyHz';
  gainField:
    | 'audioEqLowGainDb'
    | 'audioEqLowMidGainDb'
    | 'audioEqHighMidGainDb'
    | 'audioEqHighGainDb';
  fixedFrequency?: boolean;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  defaultFrequencyHz: number;
  getFrequencyHz: (settings: ResolvedAudioEqSettings) => number;
  getGainDb: (settings: ResolvedAudioEqSettings) => number;
}

interface CutHandleDefinition {
  id: 'low-cut' | 'high-cut';
  kind: 'cut';
  label: string;
  bandNumber: 1 | 2 | 3 | 4 | 5 | 6;
  description: string;
  enabledField: 'audioEqLowCutEnabled' | 'audioEqHighCutEnabled';
  frequencyField: 'audioEqLowCutFrequencyHz' | 'audioEqHighCutFrequencyHz';
  minFrequencyHz: number;
  maxFrequencyHz: number;
  defaultFrequencyHz: number;
  getEnabled: (settings: ResolvedAudioEqSettings) => boolean;
  getFrequencyHz: (settings: ResolvedAudioEqSettings) => number;
}

type AudioEqHandleDefinition = GainHandleDefinition | CutHandleDefinition;

const CURVE_WIDTH = 320;
const CURVE_HEIGHT = 240;
const CURVE_PADDING_X = 2;
const CURVE_PADDING_TOP = 2;
const CURVE_PADDING_BOTTOM = 24;
const CURVE_MIN_FREQUENCY_HZ = 20;
const CURVE_MAX_FREQUENCY_HZ = 24000;
const CURVE_DISPLAY_DB_MAX = 0;
const CURVE_DISPLAY_DB_MIN = -80;
const CURVE_DISPLAY_EQ_BASELINE_DB = -40;
const CURVE_GRID_LEVELS_DB = [0, -10, -20, -30, -40, -50, -60, -70, -80] as const;
const CURVE_GRID_FREQUENCIES_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const KEYBOARD_GAIN_STEP_DB = 0.5;
const KEYBOARD_FREQUENCY_RATIO = 1.06;
const KEYBOARD_FREQUENCY_RATIO_FAST = 1.16;

const AUDIO_EQ_HANDLES: ReadonlyArray<AudioEqHandleDefinition> = Object.freeze([
  {
    id: 'low-cut',
    kind: 'cut',
    label: 'Band 1',
    bandNumber: 1,
    description: 'Low Cut',
    enabledField: 'audioEqLowCutEnabled',
    frequencyField: 'audioEqLowCutFrequencyHz',
    minFrequencyHz: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    getEnabled: (settings) => settings.lowCutEnabled,
    getFrequencyHz: (settings) => settings.lowCutFrequencyHz,
  },
  {
    id: 'low',
    kind: 'gain',
    label: 'Band 2',
    bandNumber: 2,
    description: 'Low Shelf',
    frequencyField: 'audioEqLowFrequencyHz',
    gainField: 'audioEqLowGainDb',
    minFrequencyHz: AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.lowFrequencyHz,
    getGainDb: (settings) => settings.lowGainDb,
  },
  {
    id: 'low-mid',
    kind: 'gain',
    label: 'Band 3',
    bandNumber: 3,
    description: 'Low Mid',
    frequencyField: 'audioEqLowMidFrequencyHz',
    gainField: 'audioEqLowMidGainDb',
    minFrequencyHz: AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.lowMidFrequencyHz,
    getGainDb: (settings) => settings.lowMidGainDb,
  },
  {
    id: 'high-mid',
    kind: 'gain',
    label: 'Band 4',
    bandNumber: 4,
    description: 'High Mid',
    frequencyField: 'audioEqHighMidFrequencyHz',
    gainField: 'audioEqHighMidGainDb',
    minFrequencyHz: AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.highMidFrequencyHz,
    getGainDb: (settings) => settings.highMidGainDb,
  },
  {
    id: 'high',
    kind: 'gain',
    label: 'Band 5',
    bandNumber: 5,
    description: 'High Shelf',
    frequencyField: 'audioEqHighFrequencyHz',
    gainField: 'audioEqHighGainDb',
    minFrequencyHz: AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ,
    getFrequencyHz: (settings) => settings.highFrequencyHz,
    getGainDb: (settings) => settings.highGainDb,
  },
  {
    id: 'high-cut',
    kind: 'cut',
    label: 'Band 6',
    bandNumber: 6,
    description: 'High Cut',
    enabledField: 'audioEqHighCutEnabled',
    frequencyField: 'audioEqHighCutFrequencyHz',
    minFrequencyHz: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
    maxFrequencyHz: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
    defaultFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    getEnabled: (settings) => settings.highCutEnabled,
    getFrequencyHz: (settings) => settings.highCutFrequencyHz,
  },
]);

function clampEqGainDb(value: number): number {
  return Math.round(clampAudioEqGainDb(value) * 10) / 10;
}

function roundFrequency(value: number): number {
  return Math.round(value);
}

function frequencyToX(frequencyHz: number): number {
  const normalized = (
    Math.log(frequencyHz) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  ) / (
    Math.log(CURVE_MAX_FREQUENCY_HZ) - Math.log(CURVE_MIN_FREQUENCY_HZ)
  );
  return CURVE_PADDING_X + normalized * (CURVE_WIDTH - CURVE_PADDING_X * 2);
}

function xToFrequency(x: number): number {
  const plotWidth = CURVE_WIDTH - CURVE_PADDING_X * 2;
  const clampedX = Math.max(CURVE_PADDING_X, Math.min(CURVE_WIDTH - CURVE_PADDING_X, x));
  const normalized = (clampedX - CURVE_PADDING_X) / Math.max(plotWidth, 1);
  return CURVE_MIN_FREQUENCY_HZ * Math.pow(CURVE_MAX_FREQUENCY_HZ / CURVE_MIN_FREQUENCY_HZ, normalized);
}

function displayDbToY(displayDb: number): number {
  const clamped = Math.max(CURVE_DISPLAY_DB_MIN, Math.min(CURVE_DISPLAY_DB_MAX, displayDb));
  const normalized = (CURVE_DISPLAY_DB_MAX - clamped) / (CURVE_DISPLAY_DB_MAX - CURVE_DISPLAY_DB_MIN);
  return CURVE_PADDING_TOP + normalized * (CURVE_HEIGHT - CURVE_PADDING_TOP - CURVE_PADDING_BOTTOM);
}

function gainToY(gainDb: number): number {
  return displayDbToY(CURVE_DISPLAY_EQ_BASELINE_DB + clampEqGainDb(gainDb));
}

function yToGain(y: number): number {
  const plotHeight = CURVE_HEIGHT - CURVE_PADDING_TOP - CURVE_PADDING_BOTTOM;
  const clampedY = Math.max(CURVE_PADDING_TOP, Math.min(CURVE_HEIGHT - CURVE_PADDING_BOTTOM, y));
  const normalized = (clampedY - CURVE_PADDING_TOP) / plotHeight;
  const displayDb = CURVE_DISPLAY_DB_MAX - normalized * (CURVE_DISPLAY_DB_MAX - CURVE_DISPLAY_DB_MIN);
  return clampEqGainDb(displayDb - CURVE_DISPLAY_EQ_BASELINE_DB);
}

function formatFrequencyLabel(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}k`;
  }
  return `${Math.round(frequencyHz)}`;
}

function nudgeFrequency(
  currentFrequencyHz: number,
  direction: -1 | 1,
  fast: boolean,
  minFrequencyHz: number,
  maxFrequencyHz: number,
): number {
  const ratio = fast ? KEYBOARD_FREQUENCY_RATIO_FAST : KEYBOARD_FREQUENCY_RATIO;
  const nextFrequencyHz = direction < 0
    ? currentFrequencyHz / ratio
    : currentFrequencyHz * ratio;
  return roundFrequency(clampAudioEqFrequencyHz(nextFrequencyHz, minFrequencyHz, maxFrequencyHz, currentFrequencyHz));
}

function mergeDisplayedSettings(
  settings: ResolvedAudioEqSettings,
  patch?: AudioEqPatch | null,
): ResolvedAudioEqSettings {
  if (!patch) return settings;
  const patchSettings = getAudioEqSettings(patch);
  const merged: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(patchSettings)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return resolveAudioEqSettings(merged as unknown as ResolvedAudioEqSettings);
}

function getCutHandleY(): number {
  return displayDbToY(CURVE_DISPLAY_EQ_BASELINE_DB);
}

function createPatchForPointer(
  handle: AudioEqHandleDefinition,
  localX: number,
  localY: number,
): AudioEqPatch {
  const frequencyHz = roundFrequency(clampAudioEqFrequencyHz(
    xToFrequency(localX),
    handle.minFrequencyHz,
    handle.maxFrequencyHz,
    handle.defaultFrequencyHz,
  ));

  if (handle.kind === 'cut') {
    return {
      [handle.enabledField]: true,
      [handle.frequencyField]: frequencyHz,
    };
  }

  const patch: AudioEqPatch = {
    [handle.gainField]: yToGain(localY),
  };
  if (handle.frequencyField) {
    patch[handle.frequencyField] = frequencyHz;
  }
  return patch;
}

function getResetPatch(handle: AudioEqHandleDefinition): AudioEqPatch {
  if (handle.kind === 'cut') {
    return {
      [handle.enabledField]: false,
      [handle.frequencyField]: handle.defaultFrequencyHz,
    };
  }

  const patch: AudioEqPatch = {
    [handle.gainField]: 0,
  };
  if (handle.frequencyField) {
    patch[handle.frequencyField] = handle.defaultFrequencyHz;
  }
  return patch;
}

export function AudioEqCurveEditor({
  settings,
  disabled = false,
  className,
  graphClassName,
  onLiveChange,
  onChange,
}: AudioEqCurveEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragBaseSettingsRef = useRef<ResolvedAudioEqSettings | null>(null);
  const [dragState, setDragState] = useState<{ handleId: AudioEqHandleDefinition['id']; pointerId: number } | null>(null);
  const [draftPatch, setDraftPatch] = useState<AudioEqPatch | null>(null);
  const displayedBaseSettings = dragState
    ? (dragBaseSettingsRef.current ?? settings)
    : settings;

  const displayedSettings = useMemo(
    () => mergeDisplayedSettings(displayedBaseSettings, draftPatch),
    [displayedBaseSettings, draftPatch],
  );

  const responsePoints = useMemo(
    () => sampleAudioEqResponseCurve(displayedSettings, {
      sampleCount: 96,
      minFrequencyHz: CURVE_MIN_FREQUENCY_HZ,
      maxFrequencyHz: CURVE_MAX_FREQUENCY_HZ,
    }),
    [displayedSettings],
  );

  const responsePath = useMemo(
    () => responsePoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${frequencyToX(point.frequencyHz)} ${gainToY(point.gainDb)}`)
      .join(' '),
    [responsePoints],
  );

  const getLocalPointer = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: ((clientX - rect.left) / rect.width) * CURVE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CURVE_HEIGHT,
    };
  }, []);

  const beginDrag = useCallback((handle: AudioEqHandleDefinition, pointerId: number, clientX: number, clientY: number) => {
    if (disabled) return;
    const root = rootRef.current;
    const localPointer = getLocalPointer(clientX, clientY);
    if (!root || !localPointer) return;

    root.setPointerCapture?.(pointerId);
    dragBaseSettingsRef.current = settings;
    const patch = createPatchForPointer(handle, localPointer.x, localPointer.y);
    setDragState({ handleId: handle.id, pointerId });
    setDraftPatch(patch);
    onLiveChange(patch);
  }, [disabled, getLocalPointer, onLiveChange, settings]);

  const updateDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragState) return;
    const localPointer = getLocalPointer(clientX, clientY);
    if (!localPointer) return;

    const handle = AUDIO_EQ_HANDLES.find((entry) => entry.id === dragState.handleId);
    if (!handle) return;

    const patch = createPatchForPointer(handle, localPointer.x, localPointer.y);
    setDraftPatch(patch);
    onLiveChange(patch);
  }, [dragState, getLocalPointer, onLiveChange]);

  const finishDrag = useCallback((pointerId?: number) => {
    if (!dragState) return;
    if (pointerId !== undefined && dragState.pointerId !== pointerId) return;

    const root = rootRef.current;
    root?.releasePointerCapture?.(dragState.pointerId);
    dragBaseSettingsRef.current = null;

    const patch = draftPatch ?? {};
    setDragState(null);
    setDraftPatch(null);
    onChange(patch);
  }, [dragState, draftPatch, onChange]);

  const handleBandReset = useCallback((handle: AudioEqHandleDefinition) => {
    if (disabled) return;
    dragBaseSettingsRef.current = null;
    const patch = getResetPatch(handle);
    setDraftPatch(null);
    onLiveChange(patch);
    onChange(patch);
  }, [disabled, onChange, onLiveChange]);

  const handleBandKeyDown = useCallback((handle: AudioEqHandleDefinition, event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (handle.kind === 'cut') {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      const patch = event.key === 'Home'
        ? getResetPatch(handle)
        : {
          [handle.enabledField]: true,
          [handle.frequencyField]: nudgeFrequency(
            handle.getFrequencyHz(displayedSettings),
            event.key === 'ArrowLeft' ? -1 : 1,
            event.shiftKey,
            handle.minFrequencyHz,
            handle.maxFrequencyHz,
          ),
        };
      onLiveChange(patch);
      onChange(patch);
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();

    const currentFrequencyHz = handle.getFrequencyHz(displayedSettings);
    const currentGainDb = handle.getGainDb(displayedSettings);

    const patch: AudioEqPatch = event.key === 'Home'
      ? getResetPatch(handle)
      : {
        [handle.gainField]: event.key === 'ArrowUp' || event.key === 'ArrowDown'
          ? clampEqGainDb(currentGainDb + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : KEYBOARD_GAIN_STEP_DB))
          : currentGainDb,
      };

    if (!handle.fixedFrequency && handle.frequencyField && event.key !== 'Home') {
      patch[handle.frequencyField] = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? nudgeFrequency(
          currentFrequencyHz,
          event.key === 'ArrowLeft' ? -1 : 1,
          event.shiftKey,
          handle.minFrequencyHz,
          handle.maxFrequencyHz,
        )
        : currentFrequencyHz;
    }

    onLiveChange(patch);
    onChange(patch);
  }, [disabled, displayedSettings, onChange, onLiveChange]);

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        ref={rootRef}
        data-eq-curve-root="true"
        className={cn(
          'relative w-full overflow-hidden touch-none select-none',
          graphClassName ?? 'h-[180px] rounded-md border border-border/60 bg-muted/20',
          disabled ? 'opacity-60' : 'cursor-move',
        )}
        onPointerMove={(event) => {
          if (!dragState) return;
          updateDrag(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          finishDrag(event.pointerId);
        }}
        onPointerCancel={(event) => {
          finishDrag(event.pointerId);
        }}
      >
        <svg
          viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-label="EQ curve editor"
        >
          {CURVE_GRID_LEVELS_DB.map((level) => (
            <line
              key={level}
              x1={CURVE_PADDING_X}
              y1={displayDbToY(level)}
              x2={CURVE_WIDTH - CURVE_PADDING_X}
              y2={displayDbToY(level)}
              stroke="currentColor"
              strokeOpacity={level === CURVE_DISPLAY_EQ_BASELINE_DB ? 0.28 : 0.1}
              strokeDasharray={level === CURVE_DISPLAY_EQ_BASELINE_DB ? undefined : '2 3'}
            />
          ))}

          {CURVE_GRID_FREQUENCIES_HZ.map((frequencyHz) => (
            <line
              key={frequencyHz}
              x1={frequencyToX(frequencyHz)}
              y1={CURVE_PADDING_TOP}
              x2={frequencyToX(frequencyHz)}
              y2={CURVE_HEIGHT - CURVE_PADDING_BOTTOM}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="2 3"
            />
          ))}

          <path
            d={responsePath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.9}
            strokeWidth={2}
          />
        </svg>

        {CURVE_GRID_LEVELS_DB.map((level) => (
          <div
            key={`db-${level}`}
            className="pointer-events-none absolute left-1.5 -translate-y-1/2 text-[10px] leading-none text-current opacity-40"
            style={{ top: `${(displayDbToY(level) / CURVE_HEIGHT) * 100}%` }}
          >
            {level > 0 ? `+${level}` : level}
          </div>
        ))}

        {CURVE_GRID_FREQUENCIES_HZ.map((frequencyHz) => (
          <div
            key={`freq-${frequencyHz}`}
            className="pointer-events-none absolute -translate-x-1/2 text-[10px] leading-none text-current opacity-45"
            style={{
              left: `${(frequencyToX(frequencyHz) / CURVE_WIDTH) * 100}%`,
              bottom: '3px',
            }}
          >
            {formatFrequencyLabel(frequencyHz)}
          </div>
        ))}

        {AUDIO_EQ_HANDLES.map((handle) => {
          const frequencyHz = handle.getFrequencyHz(displayedSettings);
          const isActive = dragState?.handleId === handle.id;
          const top = handle.kind === 'cut'
            ? getCutHandleY()
            : gainToY(handle.getGainDb(displayedSettings));
          const title = handle.kind === 'cut'
            ? `${handle.label} ${handle.description} ${handle.getEnabled(displayedSettings) ? 'on' : 'off'} ${formatFrequencyLabel(frequencyHz)}`
            : `${handle.label} ${handle.description} ${handle.getGainDb(displayedSettings) > 0 ? '+' : ''}${handle.getGainDb(displayedSettings).toFixed(1)} dB @ ${formatFrequencyLabel(frequencyHz)}`;

          return (
            <button
              key={handle.id}
              type="button"
              data-eq-band={handle.id}
              aria-label={`${handle.label} EQ handle`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-background shadow-sm transition-[transform,background-color,color] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 flex items-center justify-center font-mono font-semibold leading-none',
                isActive ? 'h-5 w-5 scale-110 bg-foreground text-background' : 'h-[18px] w-[18px] bg-primary text-primary-foreground',
                handle.kind === 'cut' && !handle.getEnabled(displayedSettings) && 'bg-muted-foreground/60 text-background/80',
                disabled && 'pointer-events-none',
              )}
              style={{
                left: `${(frequencyToX(frequencyHz) / CURVE_WIDTH) * 100}%`,
                top: `${(top / CURVE_HEIGHT) * 100}%`,
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                beginDrag(handle, event.pointerId, event.clientX, event.clientY);
              }}
              onDoubleClick={() => {
                handleBandReset(handle);
              }}
              onKeyDown={(event) => {
                handleBandKeyDown(handle, event);
              }}
              title={title}
            >
              <span className="text-[8px]" data-eq-band-number={handle.bandNumber}>
                {handle.bandNumber}
              </span>
            </button>
          );
        })}

        {disabled ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] text-muted-foreground">
            Mixed EQ values
          </div>
        ) : null}
      </div>
    </div>
  );
}


