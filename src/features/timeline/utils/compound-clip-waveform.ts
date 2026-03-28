import type { CompositionOwnedAudioSource } from './composition-clip-summary';
import { getMonoPeaks, type CachedWaveform } from '../services/waveform-cache';

export function mixCompoundClipWaveformPeaks(params: {
  sources: CompositionOwnedAudioSource[];
  waveformsByMediaId: Map<string, CachedWaveform>;
  durationInFrames: number;
  fps: number;
}): { peaks: Float32Array; sampleRate: number } {
  const sampleRate = Math.max(
    1,
    ...params.sources.map((source) => params.waveformsByMediaId.get(source.mediaId)?.sampleRate ?? 0)
  );
  const totalSamples = Math.max(1, Math.ceil((params.durationInFrames / params.fps) * sampleRate));
  const peaks = new Float32Array(totalSamples);

  for (const source of params.sources) {
    const waveform = params.waveformsByMediaId.get(source.mediaId);
    if (!waveform || waveform.peaks.length === 0 || waveform.sampleRate <= 0) {
      continue;
    }
    const waveformPeaks = getMonoPeaks(waveform);

    const startSample = Math.max(0, Math.floor((source.from / params.fps) * sampleRate));
    const sourceDurationSamples = Math.max(0, Math.ceil((source.durationInFrames / params.fps) * sampleRate));
    const sourceStartSeconds = source.sourceStart / source.sourceFps;

    for (let localSample = 0; localSample < sourceDurationSamples; localSample += 1) {
      const outputSample = startSample + localSample;
      if (outputSample >= peaks.length) break;

      const localSeconds = localSample / sampleRate;
      const waveformSeconds = sourceStartSeconds + localSeconds * source.speed;
      const waveformIndex = Math.floor(waveformSeconds * waveform.sampleRate);
      if (waveformIndex < 0 || waveformIndex >= waveformPeaks.length) {
        continue;
      }

      const existing = peaks[outputSample] ?? 0;
      const next = waveformPeaks[waveformIndex] ?? 0;
      peaks[outputSample] = Math.min(1, Math.hypot(existing, next));
    }
  }

  return { peaks, sampleRate };
}
