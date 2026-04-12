export interface AudioEqSettings {
  lowGainDb?: number;
  lowMidGainDb?: number;
  midGainDb?: number;
  highMidGainDb?: number;
  highGainDb?: number;
}

export interface ResolvedAudioEqSettings {
  lowGainDb: number;
  lowMidGainDb: number;
  midGainDb: number;
  highMidGainDb: number;
  highGainDb: number;
}
