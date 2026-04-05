import { describe, expect, it } from 'vitest';
import {
  AbsoluteFill,
  HeadlessTransport,
  Player,
} from './transport-core';

describe('preview transport seam exports', () => {
  it('re-exports both transport surfaces through the preview seam', () => {
    expect(Player).toBeTruthy();
    expect(HeadlessTransport).toBeTruthy();
    expect(AbsoluteFill).toBeTruthy();
  });
});
