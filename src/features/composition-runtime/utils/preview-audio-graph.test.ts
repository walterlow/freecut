import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_Q,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq';
import {
  createPreviewClipAudioGraph,
  rampPreviewClipEq,
  setPreviewClipEq,
} from './preview-audio-graph';

class AudioParamMock {
  value = 0;
  readonly cancelledAt: number[] = [];
  readonly setCalls: Array<{ value: number; time: number }> = [];
  readonly rampCalls: Array<{ value: number; time: number }> = [];

  cancelScheduledValues(time: number) {
    this.cancelledAt.push(time);
  }

  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.setCalls.push({ value, time });
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.rampCalls.push({ value, time });
  }
}

class ConnectableNodeMock {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(target: unknown) {
    this.connections.push(target);
  }

  disconnect() {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class GainNodeMock extends ConnectableNodeMock {
  gain = new AudioParamMock();
}

class BiquadFilterNodeMock extends ConnectableNodeMock {
  type: BiquadFilterType = 'peaking';
  frequency = new AudioParamMock();
  gain = new AudioParamMock();
  Q = new AudioParamMock();
}

class IIRFilterNodeMock extends ConnectableNodeMock {
  constructor(
    readonly feedforward: number[],
    readonly feedback: number[],
  ) {
    super();
  }
}

class AudioContextMock {
  currentTime = 1.5;
  state: AudioContextState = 'running';
  sampleRate = 48000;
  destination = { kind: 'destination' };

  createGain() {
    return new GainNodeMock();
  }

  createBiquadFilter() {
    return new BiquadFilterNodeMock();
  }

  createIIRFilter(feedforward: number[], feedback: number[]) {
    return new IIRFilterNodeMock(feedforward, feedback);
  }
}

function getConnections(node: unknown): unknown[] {
  return (node as ConnectableNodeMock).connections;
}

function getRampCalls(param: unknown): Array<{ value: number; time: number }> {
  return (param as AudioParamMock).rampCalls;
}

describe('preview-audio-graph', () => {
  beforeAll(() => {
    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('webkitAudioContext', AudioContextMock);
  });

  it('creates a stage chain with default shelf and bell nodes', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 2 });

    expect(graph).not.toBeNull();
    expect(graph?.eqStageNodes).toHaveLength(2);

    const firstStage = graph!.eqStageNodes[0]!;
    const secondStage = graph!.eqStageNodes[1]!;

    expect(firstStage.band1PassNodes).toHaveLength(0);
    expect(firstStage.lowNode.type).toBe('lowshelf');
    expect(firstStage.lowNode.frequency.value).toBe(AUDIO_EQ_LOW_FREQUENCY_HZ);
    expect(firstStage.lowMidNode.type).toBe('peaking');
    expect(firstStage.lowMidNode.frequency.value).toBe(AUDIO_EQ_LOW_MID_FREQUENCY_HZ);
    expect(firstStage.lowMidNode.Q.value).toBe(AUDIO_EQ_LOW_MID_Q);
    expect(firstStage.midPeakingNode.frequency.value).toBe(AUDIO_EQ_MID_FREQUENCY_HZ);
    expect(firstStage.midPeakingNode.Q.value).toBe(AUDIO_EQ_MID_Q);
    expect(firstStage.highMidNode.frequency.value).toBe(AUDIO_EQ_HIGH_MID_FREQUENCY_HZ);
    expect(firstStage.highMidNode.Q.value).toBe(AUDIO_EQ_HIGH_MID_Q);
    expect(firstStage.highNode.type).toBe('highshelf');
    expect(firstStage.highNode.frequency.value).toBe(AUDIO_EQ_HIGH_FREQUENCY_HZ);
    expect(firstStage.band6PassNodes).toHaveLength(0);

    expect(getConnections(graph!.sourceInputNode)).toEqual([firstStage.band1BypassNode]);
    expect(getConnections(firstStage.band1BypassNode)).toEqual([firstStage.lowNode]);
    expect(getConnections(firstStage.lowNode)).toEqual([firstStage.lowMidNode]);
    expect(getConnections(firstStage.lowMidNode)).toEqual([firstStage.midPeakingNode]);
    expect(getConnections(firstStage.midPeakingNode)).toEqual([firstStage.highMidNode]);
    expect(getConnections(firstStage.highMidNode)).toEqual([firstStage.highNode]);
    expect(getConnections(firstStage.highNode)).toEqual([firstStage.band6BypassNode]);
    expect(getConnections(firstStage.band6BypassNode)).toEqual([firstStage.outputGainNode]);
    expect(getConnections(firstStage.outputGainNode)).toEqual([secondStage.band1BypassNode]);
    expect(getConnections(secondStage.band1BypassNode)).toEqual([secondStage.lowNode]);
    expect(getConnections(secondStage.highNode)).toEqual([secondStage.band6BypassNode]);
    expect(getConnections(secondStage.band6BypassNode)).toEqual([secondStage.outputGainNode]);
    expect(getConnections(secondStage.outputGainNode)).toEqual([graph!.outputGainNode]);
  });

  it('creates cut nodes when needed and ramps frequency, gain, and Q parameters', () => {
    const graph = createPreviewClipAudioGraph({ eqStageCount: 1 });
    expect(graph).not.toBeNull();

    setPreviewClipEq(graph!, [resolveAudioEqSettings({
      lowCutEnabled: true,
      lowCutFrequencyHz: 90,
      lowCutSlopeDbPerOct: 18,
      lowGainDb: 1,
      lowFrequencyHz: 150,
      lowMidGainDb: 2,
      lowMidFrequencyHz: 500,
      lowMidQ: 1.4,
      midGainDb: 3,
      highMidGainDb: 4,
      highMidFrequencyHz: 2600,
      highMidQ: 1.3,
      highGainDb: 5,
      highFrequencyHz: 7000,
      outputGainDb: 6,
      highCutEnabled: true,
      highCutFrequencyHz: 6000,
      highCutSlopeDbPerOct: 24,
    })]);

    const stage = graph!.eqStageNodes[0]!;
    expect(stage.band1PassNodes).toHaveLength(3);
    expect(stage.band6PassNodes).toHaveLength(4);
    expect(getConnections(graph!.sourceInputNode)[0]).toBe(stage.band1PassNodes[0]);
    expect(getConnections(stage.band1PassNodes.at(-1)!)[0]).toBe(stage.lowNode);
    expect(getConnections(stage.highNode)[0]).toBe(stage.band6PassNodes[0]);
    expect(getConnections(stage.band6PassNodes.at(-1)!)[0]).toBe(stage.outputGainNode);
    expect(getConnections(stage.outputGainNode)[0]).toBe(graph!.outputGainNode);

    expect(stage.lowNode.frequency.value).toBe(150);
    expect(stage.lowNode.gain.value).toBe(1);
    expect(stage.lowMidNode.frequency.value).toBe(500);
    expect(stage.lowMidNode.Q.value).toBe(1.4);
    expect(stage.lowMidNode.gain.value).toBe(2);
    expect(stage.midPeakingNode.gain.value).toBe(3);
    expect(stage.highMidNode.frequency.value).toBe(2600);
    expect(stage.highMidNode.Q.value).toBe(1.3);
    expect(stage.highMidNode.gain.value).toBe(4);
    expect(stage.highNode.frequency.value).toBe(7000);
    expect(stage.highNode.gain.value).toBe(5);
    expect(stage.outputGainNode.gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 5);

    rampPreviewClipEq(graph!, [resolveAudioEqSettings({
      lowCutEnabled: true,
      lowCutFrequencyHz: 90,
      lowCutSlopeDbPerOct: 18,
      lowGainDb: -1,
      lowFrequencyHz: 130,
      lowMidGainDb: -2,
      lowMidFrequencyHz: 450,
      lowMidQ: 1.1,
      midGainDb: -3,
      highMidGainDb: -4,
      highMidFrequencyHz: 2400,
      highMidQ: 1.05,
      highGainDb: -5,
      highFrequencyHz: 6500,
      outputGainDb: -3,
      highCutEnabled: true,
      highCutFrequencyHz: 6000,
      highCutSlopeDbPerOct: 24,
    })], 2, 0.25);

    expect(getRampCalls(stage.lowNode.frequency).at(-1)).toEqual({ value: 130, time: 2.25 });
    expect(getRampCalls(stage.lowNode.gain).at(-1)).toEqual({ value: -1, time: 2.25 });
    expect(getRampCalls(stage.lowMidNode.frequency).at(-1)).toEqual({ value: 450, time: 2.25 });
    expect(getRampCalls(stage.lowMidNode.Q).at(-1)).toEqual({ value: 1.1, time: 2.25 });
    expect(getRampCalls(stage.lowMidNode.gain).at(-1)).toEqual({ value: -2, time: 2.25 });
    expect(getRampCalls(stage.midPeakingNode.gain).at(-1)).toEqual({ value: -3, time: 2.25 });
    expect(getRampCalls(stage.highMidNode.frequency).at(-1)).toEqual({ value: 2400, time: 2.25 });
    expect(getRampCalls(stage.highMidNode.Q).at(-1)).toEqual({ value: 1.05, time: 2.25 });
    expect(getRampCalls(stage.highMidNode.gain).at(-1)).toEqual({ value: -4, time: 2.25 });
    expect(getRampCalls(stage.highNode.frequency).at(-1)).toEqual({ value: 6500, time: 2.25 });
    expect(getRampCalls(stage.highNode.gain).at(-1)).toEqual({ value: -5, time: 2.25 });
    expect(getRampCalls(stage.outputGainNode.gain).at(-1)).toEqual({ value: Math.pow(10, -3 / 20), time: 2.25 });
  });
});
