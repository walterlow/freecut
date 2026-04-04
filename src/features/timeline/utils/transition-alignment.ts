import type { TimelineItem } from '@/types/timeline';
import { getMaxTransitionDurationForHandles } from './transition-utils';

export type TransitionAlignmentMode = 'left' | 'center' | 'right';

export interface TransitionAlignmentOption {
  mode: TransitionAlignmentMode;
  label: string;
  shortLabel: string;
  description: string;
  alignment: number;
  maxDurationInFrames: number;
  canApply: boolean;
  reason?: string;
}

export interface TransitionAlignmentPreset {
  mode: TransitionAlignmentMode;
  label: string;
  shortLabel: string;
  description: string;
  alignment: number;
}

const TRANSITION_ALIGNMENT_PRESETS: ReadonlyArray<TransitionAlignmentPreset> = [
  {
    mode: 'left',
    label: 'End on Edit',
    shortLabel: 'Left',
    description: 'Transition ends on the cut and uses only the outgoing clip handle.',
    alignment: 1,
  },
  {
    mode: 'center',
    label: 'Center on Edit',
    shortLabel: 'Center',
    description: 'Transition is centered on the cut and uses handles from both clips.',
    alignment: 0.5,
  },
  {
    mode: 'right',
    label: 'Begin on Edit',
    shortLabel: 'Right',
    description: 'Transition begins on the cut and uses only the incoming clip handle.',
    alignment: 0,
  },
];

const MODE_PRIORITY: Record<TransitionAlignmentMode, number> = {
  center: 0,
  left: 1,
  right: 2,
};

const ALIGNMENT_CYCLE_ORDER: readonly TransitionAlignmentMode[] = ['left', 'center', 'right'];

function clampAlignment(alignment: number | undefined): number {
  const value = alignment ?? 0.5;
  return Math.max(0, Math.min(1, value));
}

export function getTransitionAlignmentValue(mode: TransitionAlignmentMode): number {
  return TRANSITION_ALIGNMENT_PRESETS.find((preset) => preset.mode === mode)?.alignment ?? 0.5;
}

export function getTransitionAlignmentPreset(mode: TransitionAlignmentMode): TransitionAlignmentPreset {
  return TRANSITION_ALIGNMENT_PRESETS.find((preset) => preset.mode === mode) ?? TRANSITION_ALIGNMENT_PRESETS[1]!;
}

export function getTransitionAlignmentMode(alignment: number | undefined): TransitionAlignmentMode {
  const normalized = clampAlignment(alignment);
  let best = TRANSITION_ALIGNMENT_PRESETS[0]!;
  let bestDistance = Infinity;

  for (const preset of TRANSITION_ALIGNMENT_PRESETS) {
    const distance = Math.abs(normalized - preset.alignment);
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }

  return best.mode;
}

export function getTransitionAlignmentLabel(alignment: number | undefined): string {
  return getTransitionAlignmentPreset(getTransitionAlignmentMode(alignment)).label;
}

export function getNextTransitionAlignment(alignment: number | undefined): number {
  const currentMode = getTransitionAlignmentMode(alignment);
  const currentIndex = ALIGNMENT_CYCLE_ORDER.indexOf(currentMode);
  const nextMode = ALIGNMENT_CYCLE_ORDER[(currentIndex + 1) % ALIGNMENT_CYCLE_ORDER.length] ?? 'left';
  return getTransitionAlignmentValue(nextMode);
}

export function getTransitionAlignmentOptions(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
  durationInFrames: number,
): TransitionAlignmentOption[] {
  const safeDuration = Math.max(1, Math.round(durationInFrames));

  return TRANSITION_ALIGNMENT_PRESETS.map((preset) => {
    const maxDurationInFrames = getMaxTransitionDurationForHandles(leftClip, rightClip, preset.alignment);
    const canApply = maxDurationInFrames >= safeDuration;
    const reason = maxDurationInFrames < 1
      ? 'No source handles available for this alignment at the cut.'
      : canApply
      ? undefined
      : `Max ${maxDurationInFrames} frames with the current handles.`;

    return {
      mode: preset.mode,
      label: preset.label,
      shortLabel: preset.shortLabel,
      description: preset.description,
      alignment: preset.alignment,
      maxDurationInFrames,
      canApply,
      reason,
    };
  });
}

export function resolveAutomaticTransitionAlignment(
  leftClip: TimelineItem,
  rightClip: TimelineItem,
): TransitionAlignmentOption | null {
  const options = getTransitionAlignmentOptions(leftClip, rightClip, 1)
    .filter((option) => option.maxDurationInFrames > 0)
    .toSorted((a, b) => {
      if (a.mode === 'center' && b.mode !== 'center') return -1;
      if (b.mode === 'center' && a.mode !== 'center') return 1;
      if (a.maxDurationInFrames !== b.maxDurationInFrames) {
        return b.maxDurationInFrames - a.maxDurationInFrames;
      }
      return MODE_PRIORITY[a.mode] - MODE_PRIORITY[b.mode];
    });

  return options[0] ?? null;
}
