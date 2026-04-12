export interface AudioEqSettings {
  lowGainDb?: number;
  midGainDb?: number;
  highGainDb?: number;
}

export interface ResolvedAudioEqSettings {
  lowGainDb: number;
  midGainDb: number;
  highGainDb: number;
}
