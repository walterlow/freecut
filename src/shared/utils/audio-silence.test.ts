import { detectSilentRanges } from './audio-silence'

function makeBuffer(samples: number[], sampleRate = 1000) {
  const data = new Float32Array(samples)
  return {
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  }
}

describe('detectSilentRanges', () => {
  it('detects sustained silence and applies edge padding', () => {
    const buffer = makeBuffer([
      ...Array.from({ length: 100 }, () => 0.5),
      ...Array.from({ length: 600 }, () => 0),
      ...Array.from({ length: 100 }, () => 0.5),
    ])

    expect(
      detectSilentRanges(buffer, {
        thresholdDb: -45,
        minSilenceMs: 500,
        paddingMs: 100,
        windowMs: 20,
      }),
    ).toEqual([{ start: 0.2, end: 0.6 }])
  })

  it('ignores silence shorter than the minimum duration', () => {
    const buffer = makeBuffer([
      ...Array.from({ length: 100 }, () => 0.5),
      ...Array.from({ length: 200 }, () => 0),
      ...Array.from({ length: 100 }, () => 0.5),
    ])

    expect(
      detectSilentRanges(buffer, {
        thresholdDb: -45,
        minSilenceMs: 500,
        paddingMs: 0,
        windowMs: 20,
      }),
    ).toEqual([])
  })
})
