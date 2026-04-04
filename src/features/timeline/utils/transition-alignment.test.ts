import { describe, expect, it } from 'vitest';
import {
  getNextTransitionAlignment,
  getTransitionAlignmentLabel,
  getTransitionAlignmentMode,
} from './transition-alignment';

describe('transition-alignment', () => {
  it('maps numeric alignments to Resolve-style labels', () => {
    expect(getTransitionAlignmentLabel(1)).toBe('End on Edit');
    expect(getTransitionAlignmentLabel(0.5)).toBe('Center on Edit');
    expect(getTransitionAlignmentLabel(0)).toBe('Begin on Edit');
  });

  it('cycles alignment in Resolve edit-order sequence', () => {
    expect(getTransitionAlignmentMode(getNextTransitionAlignment(1))).toBe('center');
    expect(getTransitionAlignmentMode(getNextTransitionAlignment(0.5))).toBe('right');
    expect(getTransitionAlignmentMode(getNextTransitionAlignment(0))).toBe('left');
  });
});
