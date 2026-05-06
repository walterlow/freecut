export function createReversedAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const reversed = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  })
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel)
    const output = reversed.getChannelData(channel)
    for (let i = 0; i < input.length; i += 1) {
      output[i] = input[input.length - 1 - i] ?? 0
    }
  }
  return reversed
}
