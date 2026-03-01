import { describe, expect, it } from 'vitest';
import type { TextItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { expandTextTransformForPreview } from './text-layout';

const baseItem: TextItem = {
  id: 'text-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  text: 'Hello world',
  color: '#fff',
  fontSize: 48,
  lineHeight: 1.2,
  fontFamily: 'Inter',
  fontWeight: 'normal',
  fontStyle: 'normal',
  transform: {
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    rotation: 0,
    opacity: 1,
  },
};

const baseTransform: ResolvedTransform = {
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
};

describe('expandTextTransformForPreview', () => {
  it('expands height for multi-line content growth', () => {
    const expanded = expandTextTransformForPreview(
      {
        ...baseItem,
        text: 'line one\nline two\nline three\nline four',
      },
      baseTransform
    );

    expect(expanded.height).toBeGreaterThan(baseTransform.height);
  });

  it('does not auto-expand width for long single-line text', () => {
    const expanded = expandTextTransformForPreview(
      {
        ...baseItem,
        text: 'This is a very long line of text that should push the gizmo wider',
      },
      {
        ...baseTransform,
        width: 120,
      }
    );

    expect(expanded.width).toBe(120);
  });

  it('never shrinks width or height', () => {
    const expanded = expandTextTransformForPreview(baseItem, {
      ...baseTransform,
      width: 600,
      height: 300,
    });

    expect(expanded.width).toBe(600);
    expect(expanded.height).toBe(300);
  });
});
