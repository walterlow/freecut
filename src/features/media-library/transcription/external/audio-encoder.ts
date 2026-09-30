/**
 * Audio encoding and extraction utility for external/cloud transcription providers.
 * Converts any media file (MP4, WebM, MOV, MP3, etc.) into a lightweight 16kHz mono 16-bit PCM WAV Blob.
 */

export async function extract16kHzMonoWav(file: File | Blob): Promise<Blob> {
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextClass) {
    return file
  }

  const audioCtx = new AudioContextClass({ sampleRate: 16000 })
  try {
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

    const numChannels = audioBuffer.numberOfChannels
    const length = audioBuffer.length
    const sampleRate = audioBuffer.sampleRate

    // Mix down to mono
    const mono = new Float32Array(length)
    for (let c = 0; c < numChannels; c++) {
      const channelData = audioBuffer.getChannelData(c)
      for (let i = 0; i < length; i++) {
        mono[i] = (mono[i] ?? 0) + (channelData[i] ?? 0) / numChannels
      }
    }

    let finalSamples = mono
    let finalSampleRate = sampleRate
    if (sampleRate !== 16000) {
      finalSamples = resamplePcm(mono, sampleRate, 16000)
      finalSampleRate = 16000
    }

    return encodeWavBlob(finalSamples, finalSampleRate)
  } catch {
    // If decodeAudioData fails, return the original file
    return file
  } finally {
    void audioCtx.close().catch(() => {})
  }
}

function resamplePcm(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate
  const newLength = Math.round(samples.length / ratio)
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio
    const index = Math.floor(pos)
    const frac = pos - index
    const s0 = samples[index] ?? 0
    const s1 = samples[index + 1] ?? s0
    result[i] = s0 + frac * (s1 - s0)
  }
  return result
}

function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  // Write RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')

  // Write fmt subchunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true) // NumChannels (1 = mono)
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, sampleRate * 2, true) // ByteRate
  view.setUint16(32, 2, true) // BlockAlign
  view.setUint16(34, 16, true) // BitsPerSample

  // Write data subchunk
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  // Write 16-bit PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const commaIndex = dataUrl.indexOf(',')
      if (commaIndex !== -1) {
        resolve(dataUrl.substring(commaIndex + 1))
      } else {
        resolve(dataUrl)
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
