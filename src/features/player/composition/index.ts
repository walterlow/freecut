/**
 * Composition Components - Replacements for Composition primitives
 *
 * This module provides components and utilities that replace
 * Composition's composition primitives:
 *
 * - Sequence: Time-bounded visibility
 * - AbsoluteFill: Full container positioning
 * - interpolate: Animation interpolation
 *
 * These are designed to work with the Clock system and can be
 * used independently or together.
 */

// Sequence component and hooks
export {
  Sequence,
  useSequenceContext,
  useLocalFrame,
  useSequenceFrom,
  useIsInRange,
  useSequenceVisibility,
  type SequenceProps,
} from './Sequence';

// AbsoluteFill component
export {
  AbsoluteFill,
  useAbsoluteFillStyle,
  type AbsoluteFillProps,
} from './AbsoluteFill';

// Interpolation utilities
export {
  interpolate,
  interpolateColors,
  Easing,
  clamp,
  mapRange,
  spring,
  type InterpolateOptions,
  type ExtrapolationType,
  type SpringOptions,
  type SpringConfig,
} from './interpolate';
