import { describe, expect, it } from 'vitest';
import { getPropertyAccordionGroups } from './property-groups';

describe('getPropertyAccordionGroups', () => {
  it('groups transform and audio properties in a stable order', () => {
    expect(getPropertyAccordionGroups(['volume', 'anchorY', 'y', 'anchorX', 'x'])).toEqual([
      {
        id: 'transform',
        label: 'Transform',
        properties: ['x', 'y', 'anchorX', 'anchorY'],
      },
      {
        id: 'audio',
        label: 'Audio',
        properties: ['volume'],
      },
    ]);
  });
});
