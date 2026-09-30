/**
 * SFX Synthesizer & Audio Utilities
 *
 * Provides real-time algorithmic sound synthesis via Web Audio API
 * and WAV blob encoding for instant zero-dependency playback and project export.
 */

// Cached offline audio context for WAV generation
let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedAudioContext = new AudioContextClass()
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume()
  }
  return sharedAudioContext
}

/**
 * Encode an AudioBuffer into a standard 16-bit PCM WAV Blob
 */
export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16
  const numSamples = audioBuffer.length * numChannels
  const dataSize = numSamples * (bitDepth / 8)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF Chunk
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // subchunk1size (16 for PCM)
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true) // byteRate
  view.setUint16(32, numChannels * (bitDepth / 8), true) // blockAlign
  view.setUint16(34, bitDepth, true)

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write interleaved PCM audio data
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch))
  }

  let offset = 44
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = channels[ch]
      const rawSample = channelData ? (channelData[i] ?? 0) : 0
      const sample = Math.max(-1, Math.min(1, rawSample))
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, intSample, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Procedural synthesizers for SFX categories
 */
export async function synthesizeSfx(sfxId: string): Promise<AudioBuffer> {
  const sampleRate = 44100
  let duration = 1.0

  // Calculate required buffer duration based on sound ID
  switch (sfxId) {
    case 'whoosh-fast':
      duration = 0.5
      break
    case 'swish-cinematic':
      duration = 0.8
      break
    case 'glitch-digital':
      duration = 0.4
      break
    case 'riser-tension':
      duration = 2.0
      break
    case 'impact-boom':
      duration = 1.5
      break
    case 'click-soft':
      duration = 0.1
      break
    case 'bubble-pop':
      duration = 0.2
      break
    case 'chime-success':
      duration = 1.0
      break
    case 'bell-notification':
      duration = 1.2
      break
    case 'keyboard-click':
      duration = 0.15
      break
    case 'applause':
      duration = 2.5
      break
    case 'paper-rustle':
      duration = 0.8
      break
    case 'wind-breeze':
      duration = 3.0
      break
    case 'footsteps':
      duration = 1.2
      break
    default:
      duration = 0.5
  }

  const offlineContext = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate)
  const ctx = offlineContext

  switch (sfxId) {
    case 'whoosh-fast': {
      // Filtered noise with exponential sweep
      const bufferSize = ctx.length
      const noiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate)
      const output = noiseBuffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1
      }

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 3.0
      filter.frequency.setValueAtTime(150, 0)
      filter.frequency.exponentialRampToValueAtTime(1800, duration * 0.4)
      filter.frequency.exponentialRampToValueAtTime(80, duration)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.001, 0)
      gain.gain.exponentialRampToValueAtTime(0.9, duration * 0.4)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      noise.start(0)
      break
    }

    case 'swish-cinematic': {
      // Deep whoosh + stereo pitch sweep
      const bufferSize = ctx.length
      const noiseBuffer = ctx.createBuffer(2, bufferSize, sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const out = noiseBuffer.getChannelData(ch)
        for (let i = 0; i < bufferSize; i++) {
          out[i] = Math.random() * 2 - 1
        }
      }

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(80, 0)
      filter.frequency.exponentialRampToValueAtTime(2400, duration * 0.45)
      filter.frequency.exponentialRampToValueAtTime(60, duration)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.001, 0)
      gain.gain.exponentialRampToValueAtTime(0.85, duration * 0.45)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      noise.start(0)
      break
    }

    case 'impact-boom': {
      // Sub bass sine drop + initial punch transient
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(120, 0)
      osc.frequency.exponentialRampToValueAtTime(32, duration)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(1.0, 0)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      // Click punch
      const click = ctx.createOscillator()
      click.type = 'triangle'
      click.frequency.setValueAtTime(240, 0)
      click.frequency.exponentialRampToValueAtTime(40, 0.05)
      const clickGain = ctx.createGain()
      clickGain.gain.setValueAtTime(0.8, 0)
      clickGain.gain.exponentialRampToValueAtTime(0.001, 0.05)

      click.connect(clickGain)
      clickGain.connect(ctx.destination)
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(0)
      click.start(0)
      break
    }

    case 'riser-tension': {
      // Ascending saw + frequency modulation
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(150, 0)
      osc.frequency.exponentialRampToValueAtTime(1600, duration)

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(200, 0)
      filter.frequency.exponentialRampToValueAtTime(3200, duration)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.01, 0)
      gain.gain.linearRampToValueAtTime(0.7, duration * 0.9)
      gain.gain.linearRampToValueAtTime(0.001, duration)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      osc.start(0)
      break
    }

    case 'glitch-digital': {
      // Square wave with stuttered bursts
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(440, 0)
      osc.frequency.setValueAtTime(880, 0.08)
      osc.frequency.setValueAtTime(220, 0.16)
      osc.frequency.setValueAtTime(1320, 0.24)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.5, 0)
      gain.gain.setValueAtTime(0.05, 0.07)
      gain.gain.setValueAtTime(0.5, 0.09)
      gain.gain.setValueAtTime(0.05, 0.15)
      gain.gain.setValueAtTime(0.6, 0.23)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(0)
      break
    }

    case 'bubble-pop': {
      // Fast pitch sine sweep up
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(350, 0)
      osc.frequency.exponentialRampToValueAtTime(1200, 0.08)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.8, 0)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(0)
      break
    }

    case 'chime-success': {
      // Arpeggiated bell chords: C6 (1046Hz), E6 (1318Hz), G6 (1567Hz)
      const notes = [1046.5, 1318.5, 1567.98]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq

        const gain = ctx.createGain()
        const startTime = idx * 0.09
        gain.gain.setValueAtTime(0.001, startTime)
        gain.gain.exponentialRampToValueAtTime(0.4, startTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, duration)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(startTime)
      })
      break
    }

    case 'bell-notification': {
      // Metallic harmonic bell (fundamental + high partials)
      const freqs = [880, 1760, 2640]
      const weights = [0.6, 0.3, 0.1]
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(weights[i] ?? 0.3, 0)
        gain.gain.exponentialRampToValueAtTime(0.001, duration)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(0)
      })
      break
    }

    case 'click-soft':
    case 'keyboard-click': {
      const isKey = sfxId === 'keyboard-click'
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(isKey ? 900 : 1200, 0)
      osc.frequency.exponentialRampToValueAtTime(100, duration)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.7, 0)
      gain.gain.exponentialRampToValueAtTime(0.001, duration)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(0)
      break
    }

    case 'applause':
    case 'paper-rustle':
    case 'wind-breeze':
    case 'footsteps':
    default: {
      // Granular noise texture
      const bufferSize = ctx.length
      const noiseBuffer = ctx.createBuffer(2, bufferSize, sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const out = noiseBuffer.getChannelData(ch)
        for (let i = 0; i < bufferSize; i++) {
          out[i] = (Math.random() * 2 - 1) * 0.6
        }
      }

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const filter = ctx.createBiquadFilter()
      filter.type = sfxId === 'wind-breeze' ? 'lowpass' : 'bandpass'
      filter.frequency.value = sfxId === 'wind-breeze' ? 450 : 1200

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.1, 0)
      gain.gain.linearRampToValueAtTime(0.5, duration * 0.3)
      gain.gain.linearRampToValueAtTime(0.001, duration)

      noise.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      noise.start(0)
      break
    }
  }

  return await ctx.startRendering()
}

/**
 * Preview sound through current AudioContext output
 */
export async function playSfxPreview(
  sfxId: string,
  onEnded?: () => void,
): Promise<{ stop: () => void }> {
  const ctx = getAudioContext()
  const audioBuffer = await synthesizeSfx(sfxId)
  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(ctx.destination)

  if (onEnded) {
    source.onended = () => {
      onEnded()
    }
  }

  source.start(0)

  return {
    stop: () => {
      try {
        source.stop()
      } catch {
        // Ignore if already ended
      }
    },
  }
}
