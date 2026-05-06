export type AudioEqCutSlopeDbPerOct = 6 | 12 | 18 | 24
export type AudioEqBand1Type = 'low-shelf' | 'peaking' | 'high-shelf' | 'high-pass'
export type AudioEqInnerBandType = 'low-shelf' | 'peaking' | 'high-shelf' | 'notch'
export type AudioEqBand6Type = 'low-pass' | 'low-shelf' | 'peaking' | 'high-shelf'

export interface AudioEqSettings {
  enabled?: boolean
  outputGainDb?: number
  band1Enabled?: boolean
  band1Type?: AudioEqBand1Type
  band1FrequencyHz?: number
  band1GainDb?: number
  band1Q?: number
  band1SlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  lowCutEnabled?: boolean
  lowCutFrequencyHz?: number
  lowCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  lowEnabled?: boolean
  lowType?: AudioEqInnerBandType
  lowGainDb?: number
  lowFrequencyHz?: number
  lowQ?: number
  lowMidEnabled?: boolean
  lowMidType?: AudioEqInnerBandType
  lowMidGainDb?: number
  lowMidFrequencyHz?: number
  lowMidQ?: number
  midGainDb?: number // Legacy center band retained for backward compatibility
  highMidEnabled?: boolean
  highMidType?: AudioEqInnerBandType
  highMidGainDb?: number
  highMidFrequencyHz?: number
  highMidQ?: number
  highEnabled?: boolean
  highType?: AudioEqInnerBandType
  highGainDb?: number
  highFrequencyHz?: number
  highQ?: number
  band6Enabled?: boolean
  band6Type?: AudioEqBand6Type
  band6FrequencyHz?: number
  band6GainDb?: number
  band6Q?: number
  band6SlopeDbPerOct?: AudioEqCutSlopeDbPerOct
  highCutEnabled?: boolean
  highCutFrequencyHz?: number
  highCutSlopeDbPerOct?: AudioEqCutSlopeDbPerOct
}

export interface ResolvedAudioEqSettings {
  outputGainDb: number
  band1Enabled: boolean
  band1Type: AudioEqBand1Type
  band1FrequencyHz: number
  band1GainDb: number
  band1Q: number
  band1SlopeDbPerOct: AudioEqCutSlopeDbPerOct
  lowCutEnabled: boolean
  lowCutFrequencyHz: number
  lowCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct
  lowEnabled: boolean
  lowType: AudioEqInnerBandType
  lowGainDb: number
  lowFrequencyHz: number
  lowQ: number
  lowMidEnabled: boolean
  lowMidType: AudioEqInnerBandType
  lowMidGainDb: number
  lowMidFrequencyHz: number
  lowMidQ: number
  midGainDb: number
  highMidEnabled: boolean
  highMidType: AudioEqInnerBandType
  highMidGainDb: number
  highMidFrequencyHz: number
  highMidQ: number
  highEnabled: boolean
  highType: AudioEqInnerBandType
  highGainDb: number
  highFrequencyHz: number
  highQ: number
  band6Enabled: boolean
  band6Type: AudioEqBand6Type
  band6FrequencyHz: number
  band6GainDb: number
  band6Q: number
  band6SlopeDbPerOct: AudioEqCutSlopeDbPerOct
  highCutEnabled: boolean
  highCutFrequencyHz: number
  highCutSlopeDbPerOct: AudioEqCutSlopeDbPerOct
}
