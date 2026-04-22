import { describe, expect, it, vi } from 'vitest';
import type { TextItem } from '@/types/timeline';
import type { ItemRenderContext, ItemTransform } from './canvas-item-renderer';
import { renderItem } from './canvas-item-renderer';

function createMockCtx(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text: string) => ({
      width: text.length * 10,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
    })),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D;
}

describe('canvas-item-renderer text backgrounds', () => {
  it('renders rounded text backgrounds during export', async () => {
    const item: TextItem = {
      id: 'text-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Fancy Title',
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backgroundRadius: 18,
      textPadding: 24,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      transform: {
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        rotation: 0,
        opacity: 1,
      },
    };

    const ctx = createMockCtx();
    const rctx: ItemRenderContext = {
      fps: 30,
      canvasSettings: { width: 1280, height: 720, fps: 30 },
      canvasPool: {} as ItemRenderContext['canvasPool'],
      textMeasureCache: {
        measure: vi.fn((_: OffscreenCanvasRenderingContext2D, text: string, letterSpacing: number) => {
          const width = text.length * 10;
          return width + Math.max(0, text.length - 1) * letterSpacing;
        }),
      } as unknown as ItemRenderContext['textMeasureCache'],
      renderMode: 'export',
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      imageElements: new Map(),
      gifFramesMap: new Map(),
      keyframesMap: new Map(),
      adjustmentLayers: [],
      subCompRenderData: new Map(),
    };
    const transform: ItemTransform = {
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      anchorX: 160,
      anchorY: 60,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    await renderItem(ctx, item, transform, 0, rctx);

    expect(ctx.roundRect).toHaveBeenCalledWith(480, 300, 320, 120, 18);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
