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
} from './Sequence';
export { useSequenceContext } from './sequence-context';

// AbsoluteFill component
export {
  AbsoluteFill,
} from './AbsoluteFill';

// Interpolation utilities
export {
  interpolate,
} from './interpolate';
