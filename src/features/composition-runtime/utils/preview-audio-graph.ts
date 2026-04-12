import {
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_Q,
} from '@/shared/utils/audio-eq';
import type { ResolvedAudioEqSettings } from '@/types/audio';

export const PREVIEW_AUDIO_GAIN_RAMP_SECONDS = 0.008;
export const PREVIEW_AUDIO_EQ_RAMP_SECONDS = 0.012;

interface PreviewClipAudioEqStageNodes {
  lowShelfNode: BiquadFilterNode;
  lowMidPeakingNode: BiquadFilterNode;
  midPeakingNode: BiquadFilterNode;
  highMidPeakingNode: BiquadFilterNode;
  highShelfNode: BiquadFilterNode;
}

export interface PreviewClipAudioGraph {
  context: AudioContext;
  sourceInputNode: GainNode;
  outputGainNode: GainNode;
  eqStageNodes: PreviewClipAudioEqStageNodes[];
  dispose: () => void;
}

let sharedPreviewAudioContext: AudioContext | null = null;

export function getSharedPreviewAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (sharedPreviewAudioContext === null || sharedPreviewAudioContext.state === 'closed') {
    sharedPreviewAudioContext = new AudioContextCtor();
  }

  return sharedPreviewAudioContext;
}

/**
 * Shared clip graph used by preview audio sources.
 *
 * Current chain:
 *   source -> sourceInputNode -> eqStage(s) -> outputGainNode -> destination
 */
function createPreviewClipAudioEqStage(context: AudioContext): PreviewClipAudioEqStageNodes {
  const lowShelfNode = context.createBiquadFilter();
  lowShelfNode.type = 'lowshelf';
  lowShelfNode.frequency.value = AUDIO_EQ_LOW_FREQUENCY_HZ;

  const lowMidPeakingNode = context.createBiquadFilter();
  lowMidPeakingNode.type = 'peaking';
  lowMidPeakingNode.frequency.value = AUDIO_EQ_LOW_MID_FREQUENCY_HZ;
  lowMidPeakingNode.Q.value = AUDIO_EQ_LOW_MID_Q;

  const midPeakingNode = context.createBiquadFilter();
  midPeakingNode.type = 'peaking';
  midPeakingNode.frequency.value = AUDIO_EQ_MID_FREQUENCY_HZ;
  midPeakingNode.Q.value = AUDIO_EQ_MID_Q;

  const highMidPeakingNode = context.createBiquadFilter();
  highMidPeakingNode.type = 'peaking';
  highMidPeakingNode.frequency.value = AUDIO_EQ_HIGH_MID_FREQUENCY_HZ;
  highMidPeakingNode.Q.value = AUDIO_EQ_HIGH_MID_Q;

  const highShelfNode = context.createBiquadFilter();
  highShelfNode.type = 'highshelf';
  highShelfNode.frequency.value = AUDIO_EQ_HIGH_FREQUENCY_HZ;

  lowShelfNode.connect(lowMidPeakingNode);
  lowMidPeakingNode.connect(midPeakingNode);
  midPeakingNode.connect(highMidPeakingNode);
  highMidPeakingNode.connect(highShelfNode);

  return {
    lowShelfNode,
    lowMidPeakingNode,
    midPeakingNode,
    highMidPeakingNode,
    highShelfNode,
  };
}

export function createPreviewClipAudioGraph(options?: { eqStageCount?: number }): PreviewClipAudioGraph | null {
  const context = getSharedPreviewAudioContext();
  if (!context) {
    return null;
  }

  const sourceInputNode = context.createGain();
  const outputGainNode = context.createGain();
  outputGainNode.gain.value = 0;
  const eqStageCount = Math.max(1, options?.eqStageCount ?? 1);
  const eqStageNodes = Array.from({ length: eqStageCount }, () => createPreviewClipAudioEqStage(context));

  let previousNode: AudioNode = sourceInputNode;
  for (const stageNodes of eqStageNodes) {
    previousNode.connect(stageNodes.lowShelfNode);
    previousNode = stageNodes.highShelfNode;
  }
  previousNode.connect(outputGainNode);
  outputGainNode.connect(context.destination);

  return {
    context,
    sourceInputNode,
    outputGainNode,
    eqStageNodes,
    dispose: () => {
      sourceInputNode.disconnect();
      for (const stageNodes of eqStageNodes) {
        stageNodes.lowShelfNode.disconnect();
        stageNodes.lowMidPeakingNode.disconnect();
        stageNodes.midPeakingNode.disconnect();
        stageNodes.highMidPeakingNode.disconnect();
        stageNodes.highShelfNode.disconnect();
      }
      outputGainNode.disconnect();
    },
  };
}

export function rampPreviewClipGain(
  graph: PreviewClipAudioGraph,
  targetGain: number,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_GAIN_RAMP_SECONDS,
): void {
  const safeGain = Math.max(0, targetGain);
  const gainParam = graph.outputGainNode.gain;
  gainParam.cancelScheduledValues(startAt);
  gainParam.setValueAtTime(gainParam.value, startAt);
  gainParam.linearRampToValueAtTime(safeGain, startAt + rampSeconds);
}

export function setPreviewClipGain(
  graph: PreviewClipAudioGraph,
  targetGain: number,
): void {
  graph.outputGainNode.gain.value = Math.max(0, targetGain);
}

function rampAudioParam(
  param: AudioParam,
  targetValue: number,
  startAt: number,
  rampSeconds: number,
): void {
  param.cancelScheduledValues(startAt);
  param.setValueAtTime(param.value, startAt);
  param.linearRampToValueAtTime(targetValue, startAt + rampSeconds);
}

export function rampPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_EQ_RAMP_SECONDS,
): void {
  for (let i = 0; i < graph.eqStageNodes.length; i++) {
    const stageNodes = graph.eqStageNodes[i];
    if (!stageNodes) continue;
    const targetStage = targetStages?.[i];
    const lowGain = targetStage?.lowGainDb ?? 0;
    const lowMidGain = targetStage?.lowMidGainDb ?? 0;
    const midGain = targetStage?.midGainDb ?? 0;
    const highMidGain = targetStage?.highMidGainDb ?? 0;
    const highGain = targetStage?.highGainDb ?? 0;
    rampAudioParam(stageNodes.lowShelfNode.gain, lowGain, startAt, rampSeconds);
    rampAudioParam(stageNodes.lowMidPeakingNode.gain, lowMidGain, startAt, rampSeconds);
    rampAudioParam(stageNodes.midPeakingNode.gain, midGain, startAt, rampSeconds);
    rampAudioParam(stageNodes.highMidPeakingNode.gain, highMidGain, startAt, rampSeconds);
    rampAudioParam(stageNodes.highShelfNode.gain, highGain, startAt, rampSeconds);
  }
}

export function setPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
): void {
  for (let i = 0; i < graph.eqStageNodes.length; i++) {
    const stageNodes = graph.eqStageNodes[i];
    if (!stageNodes) continue;
    const targetStage = targetStages?.[i];
    stageNodes.lowShelfNode.gain.value = targetStage?.lowGainDb ?? 0;
    stageNodes.lowMidPeakingNode.gain.value = targetStage?.lowMidGainDb ?? 0;
    stageNodes.midPeakingNode.gain.value = targetStage?.midGainDb ?? 0;
    stageNodes.highMidPeakingNode.gain.value = targetStage?.highMidGainDb ?? 0;
    stageNodes.highShelfNode.gain.value = targetStage?.highGainDb ?? 0;
  }
}
