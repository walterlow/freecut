function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels))
  const frameCount = buffer.length
  const sampleRate = buffer.sampleRate
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const pcmByteLength = frameCount * blockAlign
  const headerSize = 44

  const out = new ArrayBuffer(headerSize + pcmByteLength)
  const view = new DataView(out)
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmByteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcmByteLength, true)

  const left = buffer.getChannelData(0)
  const right = channels > 1 ? buffer.getChannelData(1) : left

  let offset = headerSize
  for (let index = 0; index < frameCount; index += 1) {
    view.setInt16(offset, floatToInt16(left[index] ?? 0), true)
    offset += 2
    if (channels > 1) {
      view.setInt16(offset, floatToInt16(right[index] ?? 0), true)
      offset += 2
    }
  }

  return new Blob([out], { type: 'audio/wav' })
}
