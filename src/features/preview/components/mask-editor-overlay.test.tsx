import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useItemsStore, useTimelineSettingsStore } from '@/features/preview/deps/timeline-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { MaskEditorOverlay } from './mask-editor-overlay';
import { useSelectionStore } from '@/shared/state/selection';
import type { CoordinateParams, Transform } from '../types/gizmo';

const PROJECT_SIZE = { width: 200, height: 120 } as const;
const PLAYER_SIZE = { width: 200, height: 120 } as const;
let mockCanvasContext: {
  scale: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  bezierCurveTo: ReturnType<typeof vi.fn>;
  quadraticCurveTo: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
};

const FULL_CANVAS_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: PROJECT_SIZE.width,
  height: PROJECT_SIZE.height,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
};

function createRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLAYER_SIZE.width,
    bottom: PLAYER_SIZE.height,
    width: PLAYER_SIZE.width,
    height: PLAYER_SIZE.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function resetStores() {
  useMaskEditorStore.getState().stopEditing();
  useItemsStore.getState().setItems([]);
  useItemsStore.getState().setTracks([
    {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    },
  ]);
  useTimelineSettingsStore.setState({
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    isDirty: false,
    isTimelineLoading: false,
  });
  useSelectionStore.getState().clearSelection();
}

describe('MaskEditorOverlay shape pen flow', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      mockCanvasContext = {
        scale: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        arc: vi.fn(),
        closePath: vi.fn(),
        bezierCurveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        setLineDash: vi.fn(),
      };
      return mockCanvasContext as unknown as CanvasRenderingContext2D;
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    resetStores();
  });

  it('creates a shape path, fits bounds, selects it, and exits editing when closed', async () => {
    useMaskEditorStore.getState().startShapePenMode();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    const { container } = render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={FULL_CANVAS_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    const clickPoint = (x: number, y: number, pointerId: number) => {
      fireEvent.pointerDown(canvas!, { clientX: x, clientY: y, pointerId });
      fireEvent.pointerUp(canvas!, { clientX: x, clientY: y, pointerId });
    };

    clickPoint(20, 20, 1);
    clickPoint(120, 20, 2);
    clickPoint(120, 80, 3);
    clickPoint(20, 20, 4);

    await waitFor(() => {
      expect(useMaskEditorStore.getState().isEditing).toBe(false);
    });

    const items = useItemsStore.getState().items;
    expect(items).toHaveLength(1);

    const shape = items[0];
    expect(shape?.type).toBe('shape');
    expect(shape?.shapeType).toBe('path');
    expect(shape?.isMask).toBe(true);
    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape!.id]);

    expect(shape?.transform?.width).toBeCloseTo(100);
    expect(shape?.transform?.height).toBeCloseTo(60);
    expect(shape?.transform?.x).toBeCloseTo(-30);
    expect(shape?.transform?.y).toBeCloseTo(-10);
    expect(shape?.pathVertices?.[0]?.position).toEqual([0, 0]);
    expect(shape?.pathVertices?.[1]?.position).toEqual([1, 0]);
    expect(shape?.pathVertices?.[2]?.position).toEqual([1, 1]);
  });

  it('closes and commits the path when the closing anchor is dragged to shape the bezier', async () => {
    useMaskEditorStore.getState().startShapePenMode();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    const { container } = render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={FULL_CANVAS_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    const clickPoint = (x: number, y: number, pointerId: number) => {
      fireEvent.pointerDown(canvas!, { clientX: x, clientY: y, pointerId });
      fireEvent.pointerUp(canvas!, { clientX: x, clientY: y, pointerId });
    };

    clickPoint(20, 20, 1);
    clickPoint(120, 20, 2);
    clickPoint(120, 80, 3);

    fireEvent.pointerDown(canvas!, { clientX: 20, clientY: 20, pointerId: 4 });
    fireEvent.pointerMove(canvas!, { clientX: 5, clientY: 45, pointerId: 4 });
    fireEvent.pointerUp(canvas!, { clientX: 5, clientY: 45, pointerId: 4 });

    await waitFor(() => {
      expect(useMaskEditorStore.getState().isEditing).toBe(false);
    });

    const shape = useItemsStore.getState().items[0];
    expect(shape?.type).toBe('shape');
    expect(shape?.shapeType).toBe('path');
    expect(shape?.pathVertices?.[0]?.inHandle[0]).not.toBeCloseTo(0);
    expect(shape?.pathVertices?.[0]?.inHandle[1]).not.toBeCloseTo(0);
    expect(shape?.pathVertices?.[0]?.outHandle[0]).not.toBeCloseTo(0);
    expect(shape?.pathVertices?.[0]?.outHandle[1]).not.toBeCloseTo(0);
  });

  it('renders the closing segment while dragging the final bezier', async () => {
    useMaskEditorStore.getState().startShapePenMode();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    const { container } = render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={FULL_CANVAS_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    const clickPoint = (x: number, y: number, pointerId: number) => {
      fireEvent.pointerDown(canvas!, { clientX: x, clientY: y, pointerId });
      fireEvent.pointerUp(canvas!, { clientX: x, clientY: y, pointerId });
    };

    clickPoint(20, 20, 1);
    clickPoint(120, 20, 2);
    clickPoint(120, 80, 3);

    mockCanvasContext.bezierCurveTo.mockClear();

    fireEvent.pointerDown(canvas!, { clientX: 20, clientY: 20, pointerId: 4 });
    fireEvent.pointerMove(canvas!, { clientX: 5, clientY: 45, pointerId: 4 });

    await waitFor(() => {
      expect(
        mockCanvasContext.bezierCurveTo.mock.calls.some((call) =>
          Math.abs(call[0] - 120) < 0.001 &&
          Math.abs(call[1] - 80) < 0.001 &&
          Math.abs(call[2] - 35) < 0.001 &&
          Math.abs(call[3] - -5) < 0.001 &&
          Math.abs(call[4] - 20) < 0.001 &&
          Math.abs(call[5] - 20) < 0.001
        )
      ).toBe(true);
    });
  });

  it('removes the last planted point with backspace and keeps pen mode active', async () => {
    useMaskEditorStore.getState().startShapePenMode();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    const { container } = render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={FULL_CANVAS_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    const clickPoint = (x: number, y: number, pointerId: number) => {
      fireEvent.pointerDown(canvas!, { clientX: x, clientY: y, pointerId });
      fireEvent.pointerUp(canvas!, { clientX: x, clientY: y, pointerId });
    };

    clickPoint(20, 20, 1);
    clickPoint(120, 20, 2);
    clickPoint(120, 80, 3);

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(useMaskEditorStore.getState().penMode).toBe(true);
    expect(useMaskEditorStore.getState().isEditing).toBe(true);
    expect(useMaskEditorStore.getState().penVertices).toHaveLength(2);

    clickPoint(60, 90, 4);
    clickPoint(20, 20, 5);

    await waitFor(() => {
      expect(useMaskEditorStore.getState().isEditing).toBe(false);
    });

    expect(useItemsStore.getState().items).toHaveLength(1);
  });
});
