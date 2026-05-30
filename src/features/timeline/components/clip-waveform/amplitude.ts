/**
 * Map a window of peak samples to a normalized waveform height (0..1).
 *
 * The window's true peak drives the height, so loud, sustained content keeps its
 * real beat-to-beat structure instead of collapsing into a flat band; a small
 * mean contribution adds visual body. A gentle gamma (< 1) lifts quiet passages
 * so speech stays readable without distorting loud transients.
 *
 * We deliberately do NOT amplify `(peak - secondPeak)`: that "needle" term turned
 * isolated transients into disproportionate spikes, worst at low zoom where each
 * pixel column folds in a wider time window.
 */
const PEAK_WEIGHT = 0.85
const MEAN_WEIGHT = 0.15
const PERCEPTUAL_GAMMA = 0.72

export function computeWaveformAmplitude(
  windowPeak: number,
  windowSum: number,
  sampleCount: number,
  normalizationPeak: number,
): number {
  if (sampleCount <= 0 || normalizationPeak <= 0) {
    return 0
  }
  const peak = Math.min(1, windowPeak / normalizationPeak)
  const mean = Math.min(1, windowSum / sampleCount / normalizationPeak)
  const linear = peak * PEAK_WEIGHT + mean * MEAN_WEIGHT
  return linear <= 0.001 ? 0 : Math.pow(linear, PERCEPTUAL_GAMMA)
}
