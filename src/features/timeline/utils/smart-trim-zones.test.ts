import { describe, expect, it } from 'vitest';
import {
  resolveSmartBodyIntent,
  resolveSmartTrimIntent,
  SMART_TRIM_EDGE_ZONE_PX,
  SMART_TRIM_RETENTION_PX,
  SMART_TRIM_ROLL_ZONE_PX,
  smartTrimIntentToHandle,
  smartTrimIntentToMode,
} from './smart-trim-zones';

describe('smart-trim-zones', () => {
  it('returns roll intent on the inner cut band when a neighbor exists', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX - 1,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
    })).toBe('roll-start');

    expect(resolveSmartTrimIntent({
      x: 120 - (SMART_TRIM_ROLL_ZONE_PX - 1),
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
    })).toBe('roll-end');
  });

  it('falls back to plain trim on outer edge bands', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX + 2,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
    })).toBe('trim-start');

    expect(resolveSmartTrimIntent({
      x: 120 - (SMART_TRIM_ROLL_ZONE_PX + 2),
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
    })).toBe('trim-end');
  });

  it('uses ripple intent on transition bridge edge bands', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX + 2,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      hasStartBridge: true,
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: 120 - (SMART_TRIM_ROLL_ZONE_PX + 2),
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
      hasEndBridge: true,
    })).toBe('ripple-end');
  });

  it('uses ripple intent on outer edge bands in trim edit mode', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX + 2,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      preferRippleOuterEdges: true,
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: 120 - (SMART_TRIM_ROLL_ZONE_PX + 2),
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: true,
      preferRippleOuterEdges: true,
    })).toBe('ripple-end');
  });

  it('uses plain trim when no adjacent neighbor exists for rolling', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX - 1,
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: false,
    })).toBe('trim-start');

    expect(resolveSmartTrimIntent({
      x: 120 - (SMART_TRIM_ROLL_ZONE_PX - 1),
      width: 120,
      hasLeftNeighbor: false,
      hasRightNeighbor: false,
    })).toBe('trim-end');
  });

  it('returns null away from smart edge zones', () => {
    expect(resolveSmartTrimIntent({
      x: 40,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: true,
    })).toBeNull();
  });

  it('keeps edge intent sticky until the pointer clearly leaves the zone', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_EDGE_ZONE_PX - 1,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      currentIntent: 'trim-start',
    })).toBe('trim-start');

    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_EDGE_ZONE_PX - 1,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      hasStartBridge: true,
      currentIntent: 'ripple-start',
    })).toBe('ripple-start');

    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX + SMART_TRIM_RETENTION_PX - 1,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      currentIntent: 'roll-start',
    })).toBe('roll-start');
  });

  it('switches from roll to trim sooner with tighter thresholds', () => {
    expect(resolveSmartTrimIntent({
      x: SMART_TRIM_ROLL_ZONE_PX + SMART_TRIM_RETENTION_PX + 1,
      width: 120,
      hasLeftNeighbor: true,
      hasRightNeighbor: false,
      currentIntent: 'roll-start',
    })).toBe('trim-start');
  });

  it('maps intent to handle and mode', () => {
    expect(smartTrimIntentToHandle('roll-start')).toBe('start');
    expect(smartTrimIntentToHandle('trim-end')).toBe('end');
    expect(smartTrimIntentToHandle('ripple-end')).toBe('end');
    expect(smartTrimIntentToMode('roll-start')).toBe('rolling');
    expect(smartTrimIntentToMode('ripple-end')).toBe('ripple');
    expect(smartTrimIntentToMode('trim-end')).toBeNull();
    expect(smartTrimIntentToMode(null)).toBeNull();
  });

  it('maps top label row to slide and lower body to slip', () => {
    expect(resolveSmartBodyIntent({
      y: 8,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
    })).toBe('slide-body');

    expect(resolveSmartBodyIntent({
      y: 24,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
    })).toBe('slip-body');
  });

  it('returns null for non-media or invalid body geometry', () => {
    expect(resolveSmartBodyIntent({
      y: 10,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: false,
    })).toBeNull();

    expect(resolveSmartBodyIntent({
      y: 10,
      height: 10,
      labelRowHeight: 10,
      isMediaItem: true,
    })).toBeNull();
  });

  it('keeps body intent sticky around the row boundary', () => {
    expect(resolveSmartBodyIntent({
      y: 19,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
      currentIntent: 'slide-body',
    })).toBe('slide-body');

    expect(resolveSmartBodyIntent({
      y: 12,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
      currentIntent: 'slip-body',
    })).toBe('slip-body');
  });

  it('switches from slip to slide soon after re-entering the title row', () => {
    expect(resolveSmartBodyIntent({
      y: 11,
      height: 40,
      labelRowHeight: 14,
      isMediaItem: true,
      currentIntent: 'slip-body',
    })).toBe('slide-body');
  });
});
