import { describe, expect, it } from 'vitest';
import { calculateWipeClipPath } from './engine';

describe('calculateWipeClipPath', () => {
  it('reveals incoming from left while hiding outgoing from left', () => {
    expect(calculateWipeClipPath(0, 'from-left', false)).toBe('inset(0 100% 0 0)');
    expect(calculateWipeClipPath(0.5, 'from-left', false)).toBe('inset(0 50% 0 0)');
    expect(calculateWipeClipPath(1, 'from-left', false)).toBe('inset(0 0% 0 0)');

    expect(calculateWipeClipPath(0, 'from-left', true)).toBe('inset(0 0 0 0%)');
    expect(calculateWipeClipPath(0.5, 'from-left', true)).toBe('inset(0 0 0 50%)');
    expect(calculateWipeClipPath(1, 'from-left', true)).toBe('inset(0 0 0 100%)');
  });

  it('uses mirrored behavior for from-right', () => {
    expect(calculateWipeClipPath(0, 'from-right', false)).toBe('inset(0 0 0 100%)');
    expect(calculateWipeClipPath(1, 'from-right', false)).toBe('inset(0 0 0 0%)');
    expect(calculateWipeClipPath(0, 'from-right', true)).toBe('inset(0 0% 0 0)');
    expect(calculateWipeClipPath(1, 'from-right', true)).toBe('inset(0 100% 0 0)');
  });

  it('clamps progress outside 0-1', () => {
    expect(calculateWipeClipPath(-2, 'from-top', false)).toBe('inset(0 0 100% 0)');
    expect(calculateWipeClipPath(2, 'from-bottom', true)).toBe('inset(0 0 100% 0)');
  });
});
