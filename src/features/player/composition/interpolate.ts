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
 * - Color interpolation
 */

// ============================================
// Types
// ============================================

export type ExtrapolationType = 'clamp' | 'extend' | 'wrap' | 'identity';

export interface InterpolateOptions {
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

// ============================================
// Easing Functions
// ============================================

/**
 * Common easing functions
 */
export const Easing = {
  /** Linear easing (no easing) */
  linear: (t: number): number => t,

  /** Quadratic ease in */
  easeIn: (t: number): number => t * t,

  /** Quadratic ease out */
  easeOut: (t: number): number => t * (2 - t),

  /** Quadratic ease in-out */
  easeInOut: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  /** Cubic ease in */
  cubicIn: (t: number): number => t * t * t,

  /** Cubic ease out */
  cubicOut: (t: number): number => (t - 1) ** 3 + 1,

  /** Cubic ease in-out */
  cubicInOut: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  /** Sine ease in */
  sineIn: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),

  /** Sine ease out */
  sineOut: (t: number): number => Math.sin((t * Math.PI) / 2),

  /** Sine ease in-out */
  sineInOut: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,

  /** Exponential ease in */
  expoIn: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),

  /** Exponential ease out */
  expoOut: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  /** Exponential ease in-out */
  expoInOut: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  /** Elastic ease in */
  elasticIn: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
  },

  /** Elastic ease out */
  elasticOut: (t: number): number => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },

  /** Back ease in (overshoots then returns) */
  backIn: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },

  /** Back ease out */
  backOut: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },

  /** Bounce ease out */
  bounceOut: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  },

  /** Bounce ease in */
  bounceIn: (t: number): number => 1 - Easing.bounceOut(1 - t),

  /**
   * Create a custom bezier easing function
   *
   * @param x1 - First control point x
   * @param y1 - First control point y
   * @param x2 - Second control point x
   * @param y2 - Second control point y
   * @returns Easing function
   */
  bezier: (x1: number, y1: number, x2: number, y2: number) => {
    // Attempt to find t for given x using Newton-Raphson
    return (t: number): number => {
      // For simple cases, use approximation
      const ax = 3 * x1 - 3 * x2 + 1;
      const bx = 3 * x2 - 6 * x1;
      const cx = 3 * x1;

      const ay = 3 * y1 - 3 * y2 + 1;
      const by = 3 * y2 - 6 * y1;
      const cy = 3 * y1;

      // Newton-Raphson iteration to find t for x
      let guess = t;
      for (let i = 0; i < 8; i++) {
        const currentX = ((ax * guess + bx) * guess + cx) * guess;
        const currentSlope = (3 * ax * guess + 2 * bx) * guess + cx;
        if (Math.abs(currentSlope) < 1e-6) break;
        guess = guess - (currentX - t) / currentSlope;
      }

      // Calculate y for the found t
      return ((ay * guess + by) * guess + cy) * guess;
    };
  },
};

// ============================================
// Color Interpolation
// ============================================

/**
 * Parse a color string to RGB components
 */
function parseColor(color: string): [number, number, number, number] {
  // Handle hex colors
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (hex.length === 6) {
      hex = hex + 'ff';
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return [r, g, b, a];
  }

  // Handle rgb/rgba colors
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (match) {
    return [
      parseInt(match[1]!, 10),
      parseInt(match[2]!, 10),
      parseInt(match[3]!, 10),
      match[4] ? parseFloat(match[4]) : 1,
    ];
  }

  // Default to black
  return [0, 0, 0, 1];
}

/**
 * Convert RGB components to hex string
 */
function rgbToHex(r: number, g: number, b: number, a: number = 1): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');

  if (a < 1) {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a * 255)}`;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Interpolate between colors
 *
 * @param input - The current input value
 * @param inputRange - Array of input keyframes
 * @param outputRange - Array of color strings
 * @param options - Interpolation options
 * @returns Interpolated color as hex string
 */
export function interpolateColors(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly string[],
  options: InterpolateOptions = {}
): string {
  // Parse all colors
  const parsedColors = outputRange.map(parseColor);

  // Create separate ranges for each channel
  const rRange = parsedColors.map((c) => c[0]);
  const gRange = parsedColors.map((c) => c[1]);
  const bRange = parsedColors.map((c) => c[2]);
  const aRange = parsedColors.map((c) => c[3]);

  // Interpolate each channel
  const r = interpolate(input, inputRange, rRange, options);
  const g = interpolate(input, inputRange, gRange, options);
  const b = interpolate(input, inputRange, bRange, options);
  const a = interpolate(input, inputRange, aRange, options);

  return rgbToHex(r, g, b, a);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Clamp a value to a range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value from one range to another
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return interpolate(value, [inMin, inMax], [outMin, outMax], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/**
 * Spring configuration options
 */
export interface SpringConfig {
  damping?: number;
  mass?: number;
  stiffness?: number;
  overshootClamping?: boolean;
}

/**
 * Spring function options (Composition-compatible API)
 */
export interface SpringOptions {
  frame: number;
  fps: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  durationInFrames?: number;
  reverse?: boolean;
  delay?: number;
}

/**
 * Spring interpolation (Composition-compatible)
 *
 * Creates a spring animation value that progresses from 0 to 1
 * (or from/to values if specified) using spring physics.
 *
 * @param options - Spring configuration
 * @returns Spring value (0 to ~1, may overshoot unless clamped)
 *
 * @example
 * const value = spring({
 *   frame,
 *   fps,
 *   config: { stiffness: 180, damping: 12 }
 * });
 */
export function spring(options: SpringOptions): number {
  const {
    frame,
    fps,
    config = {},
    from = 0,
    to = 1,
    durationInFrames,
    reverse = false,
    delay = 0,
  } = options;

  const {
    damping = 10,
    mass = 1,
    stiffness = 100,
    overshootClamping = false,
  } = config;

  // Handle delay
  const effectiveFrame = frame - delay;
  if (effectiveFrame < 0) {
    return reverse ? to : from;
  }

  // Calculate time, optionally scaled by durationInFrames
  let t = effectiveFrame / fps;

  // If durationInFrames is specified, scale the animation
  if (durationInFrames !== undefined && durationInFrames > 0) {
    // Scale factor to fit spring within duration
    const targetDuration = durationInFrames / fps;
    // Use a scaling factor to compress/stretch the spring
    // This ensures the spring settles around the specified duration
    t = t * (3.0 / targetDuration); // 3.0 is approximately when a default spring settles
  }

  // Spring physics
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let value: number;
  if (zeta < 1) {
    // Underdamped (bouncy)
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    value =
      1 -
      Math.exp(-zeta * omega * t) *
        (Math.cos(omegaD * t) + (zeta * omega * Math.sin(omegaD * t)) / omegaD);
  } else if (zeta === 1) {
    // Critically damped
    value = 1 - Math.exp(-omega * t) * (1 + omega * t);
  } else {
    // Overdamped
    const s1 = -omega * (zeta + Math.sqrt(zeta * zeta - 1));
    const s2 = -omega * (zeta - Math.sqrt(zeta * zeta - 1));
    const A = 1 / (s2 - s1);
    value = 1 - A * (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t));
  }

  // Apply overshoot clamping if requested
  if (overshootClamping) {
    value = Math.max(0, Math.min(1, value));
  }

  // Handle reverse
  if (reverse) {
    value = 1 - value;
  }

  // Map to from/to range
  return from + value * (to - from);
}
