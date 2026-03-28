export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const firstChannel = channels[0];
  if (!firstChannel) {
    return new Float32Array(0);
  }

  if (channels.length === 1) {
    return firstChannel.slice();
  }

  const mono = new Float32Array(firstChannel.length);
  for (let i = 0; i < firstChannel.length; i++) {
    let sum = 0;
    for (const channel of channels) {
      sum += channel[i] ?? 0;
    }
    mono[i] = sum / channels.length;
  }

  return mono;
}

export function resampleTo16kHz(samples: Float32Array, sourceSampleRate: number): Float32Array {
  const targetSampleRate = 16_000;
  if (samples.length === 0 || sourceSampleRate === targetSampleRate) {
    return samples.slice();
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const resampled = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const mix = sourceIndex - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    resampled[i] = left + (right - left) * mix;
  }

  return resampled;
}
