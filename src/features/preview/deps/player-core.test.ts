import { describe, expect, it } from 'vitest';
import {
  AbsoluteFill,
  HeadlessPlayerTransport,
  Player,
} from './player-core';

describe('player-core exports', () => {
  it('re-exports both transport surfaces through the preview seam', () => {
    expect(Player).toBeTruthy();
    expect(HeadlessPlayerTransport).toBeTruthy();
    expect(AbsoluteFill).toBeTruthy();
  });
});
