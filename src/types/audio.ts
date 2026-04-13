export type AudioEqCutSlopeDbPerOct = 6 | 12 | 18 | 24;

export interface AudioEqSettings {
  enabled?: boolean;
  lowCutEnabled?: boolean;
  lowCutFrequencyHz?: number;
  lowCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
  lowGainDb?: number;
  lowFrequencyHz?: number;
  lowMidGainDb?: number;
  lowMidFrequencyHz?: number;
  lowMidQ?: number;
  midGainDb?: number; // Legacy center band retained for backward compatibility
  highMidGainDb?: number;
  highMidFrequencyHz?: number;
  highMidQ?: number;
  highGainDb?: number;
  highFrequencyHz?: number;
  highCutEnabled?: boolean;
  highCutFrequencyHz?: number;
  highCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct;
}

export interface ResolvedAudioEqSettings {
  lowCutEnabled: boolean;
  lowCutFrequencyHz: number;
  lowCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct;
  lowGainDb: number;
  lowFrequencyHz: number;
  lowMidGainDb: number;
  lowMidFrequencyHz: number;
  lowMidQ: number;
  midGainDb: number;
  highMidGainDb: number;
  highMidFrequencyHz: number;
  highMidQ: number;
  highGainDb: number;
  highFrequencyHz: number;
  highCutEnabled: boolean;
  highCutFrequencyHz: number;
  highCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct;
}
