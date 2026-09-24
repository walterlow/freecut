/**
 * Resolves the audio fade fields and the `AudioClipFadeSpan` attached to every
 * segment, so plain, transition and nested segments resolve their fade curves
 * identically.
 */

import type { AudioClipFadeSpan } from '@/shared/utils/audio-fade-curve'

/** The fade durations and curves an item's own `audioFade*` properties describe. */
export interface ItemFadeSource {
  audioFadeIn?: number
  audioFadeOut?: number
  audioFadeInCurve?: number
  audioFadeOutCurve?: number
  audioFadeInCurveX?: number
  audioFadeOutCurveX?: number
}

export interface ItemFadeFields {
  fadeInFrames: number
  fadeOutFrames: number
  fadeInCurve: number
  fadeOutCurve: number
  fadeInCurveX: number
  fadeOutCurveX: number
}

/**
 * Fade fields for a segment whose fades run at the timeline fps, unclipped:
 * linear by default, with the standard horizontal bias.
 */
export function resolveItemFadeFields(item: ItemFadeSource, fps: number): ItemFadeFields {
  return {
    fadeInFrames: (item.audioFadeIn ?? 0) * fps,
    fadeOutFrames: (item.audioFadeOut ?? 0) * fps,
    fadeInCurve: item.audioFadeInCurve ?? 0,
    fadeOutCurve: item.audioFadeOutCurve ?? 0,
    fadeInCurveX: item.audioFadeInCurveX ?? 0.52,
    fadeOutCurveX: item.audioFadeOutCurveX ?? 0.52,
  }
}

export function buildClipFadeSpan(params: {
  startFrame: number
  durationInFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  fadeInCurve?: number
  fadeOutCurve?: number
  fadeInCurveX?: number
  fadeOutCurveX?: number
}): AudioClipFadeSpan {
  return {
    startFrame: params.startFrame,
    durationInFrames: params.durationInFrames,
    fadeInFrames: params.fadeInFrames ?? 0,
    fadeOutFrames: params.fadeOutFrames ?? 0,
    fadeInCurve: params.fadeInCurve ?? 0,
    fadeOutCurve: params.fadeOutCurve ?? 0,
    fadeInCurveX: params.fadeInCurveX ?? 0.52,
    fadeOutCurveX: params.fadeOutCurveX ?? 0.52,
  }
}
