/**
 * interpolate.ts - Animation interpolation utilities
 *
 * Provides interpolation functions for animating values based on
 * the current frame. Replacement for Composition's interpolate function.
 *
 * Features:
 * - Linear interpolation between keyframes
 * - Extrapolation control (clamp, extend, etc.)
 * - Easing functions
 */

// ============================================
// Types
// ============================================

type ExtrapolationType = 'clamp' | 'extend' | 'wrap' | 'identity';

interface InterpolateOptions {
  /** How to handle values before the input range */
  extrapolateLeft?: ExtrapolationType;
  /** How to handle values after the input range */
  extrapolateRight?: ExtrapolationType;
  /** Easing function to apply */
  easing?: (t: number) => number;
}

// ============================================
// Main Interpolate Function
// ============================================

/**
 * Interpolate a value based on input/output ranges
 *
 * @param input - The current input value (e.g., frame number)
 * @param inputRange - Array of input keyframes [in1, in2, in3, ...]
 * @param outputRange - Array of output values [out1, out2, out3, ...]
 * @param options - Interpolation options
 * @returns The interpolated output value
 *
 * @example
 * // Fade in over 30 frames
 * const opacity = interpolate(frame, [0, 30], [0, 1]);
 *
 * @example
 * // Move and fade with clamping
 * const x = interpolate(frame, [0, 30, 60], [0, 100, 100], {
 *   extrapolateLeft: 'clamp',
 *   extrapolateRight: 'clamp',
 * });
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {}
): number {
  const {
    extrapolateLeft = 'extend',
    extrapolateRight = 'extend',
    easing,
  } = options;

  // Validate ranges
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length`
    );
  }

  if (inputRange.length < 2) {
    throw new Error('inputRange must have at least 2 values');
  }

  // Find the segment containing the input
  let segmentIndex = 0;
  for (let i = 1; i < inputRange.length; i++) {
    if (input < inputRange[i]!) {
      break;
    }
    segmentIndex = i;
  }

  // Handle extrapolation before the range
  if (input < inputRange[0]!) {
    const firstInput = inputRange[0]!;
    const firstOutput = outputRange[0]!;

    switch (extrapolateLeft) {
      case 'clamp':
        return firstOutput;
      case 'identity':
        return input;
      case 'wrap': {
        const range = inputRange[inputRange.length - 1]! - firstInput;
        const wrapped = ((((input - firstInput) % range) + range) % range) + firstInput;
        return interpolate(wrapped, inputRange, outputRange, {
          ...options,
          extrapolateLeft: 'extend',
        });
      }
      case 'extend':
      default: {
        // Linear extrapolation based on first segment
        if (inputRange.length >= 2) {
          const secondInput = inputRange[1]!;
          const secondOutput = outputRange[1]!;
          const slope = (secondOutput - firstOutput) / (secondInput - firstInput);
          return firstOutput + slope * (input - firstInput);
        }
        return firstOutput;
      }
    }
  }

  // Handle extrapolation after the range
  const lastIndex = inputRange.length - 1;
  if (input > inputRange[lastIndex]!) {
    const lastInput = inputRange[lastIndex]!;
    const lastOutput = outputRange[lastIndex]!;

    switch (extrapolateRight) {
      case 'clamp':
        return lastOutput;
      case 'identity':
        return input;
      case 'wrap': {
        const firstInput = inputRange[0]!;
        const range = lastInput - firstInput;
        const wrapped = ((((input - firstInput) % range) + range) % range) + firstInput;
        return interpolate(wrapped, inputRange, outputRange, {
          ...options,
          extrapolateRight: 'extend',
        });
      }
      case 'extend':
      default: {
        // Linear extrapolation based on last segment
        if (inputRange.length >= 2) {
          const prevInput = inputRange[lastIndex - 1]!;
          const prevOutput = outputRange[lastIndex - 1]!;
          const slope = (lastOutput - prevOutput) / (lastInput - prevInput);
          return lastOutput + slope * (input - lastInput);
        }
        return lastOutput;
      }
    }
  }

  // Normal interpolation within range
  const inputStart = inputRange[segmentIndex]!;
  const inputEnd = inputRange[Math.min(segmentIndex + 1, lastIndex)]!;
  const outputStart = outputRange[segmentIndex]!;
  const outputEnd = outputRange[Math.min(segmentIndex + 1, lastIndex)]!;

  // Calculate progress within this segment (0 to 1)
  let progress = 0;
  if (inputEnd !== inputStart) {
    progress = (input - inputStart) / (inputEnd - inputStart);
  }

  // Apply easing if provided
  if (easing) {
    progress = easing(progress);
  }

  // Linear interpolation
  return outputStart + progress * (outputEnd - outputStart);
}
