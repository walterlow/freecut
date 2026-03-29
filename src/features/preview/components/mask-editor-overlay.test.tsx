import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useItemsStore, useTimelineSettingsStore, useTimelineStore, useTransitionsStore } from '@/features/preview/deps/timeline-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { useGizmoStore } from '../stores/gizmo-store';
import { MaskEditorOverlay } from './mask-editor-overlay';
import { useSelectionStore } from '@/shared/state/selection';
import { usePlaybackStore } from '@/shared/state/playback';
import type { CoordinateParams, Transform } from '../types/gizmo';

const PROJECT_SIZE = { width: 200, height: 120 } as const;
const PLAYER_SIZE = { width: 200, height: 120 } as const;
let mockCanvasContext: {
  scale: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
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

const PATH_ITEM_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 100,
  height: 60,
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
  useGizmoStore.getState().clearInteraction();
  useGizmoStore.getState().clearPreview();
  useTimelineStore.setState({ keyframes: [] });
  useTransitionsStore.getState().setTransitions([]);
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
  usePlaybackStore.getState().setCurrentFrame(0);
  useSelectionStore.getState().clearSelection();
}

describe('MaskEditorOverlay shape pen flow', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      mockCanvasContext = {
        scale: vi.fn(),
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        rect: vi.fn(),
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
    usePlaybackStore.getState().setCurrentFrame(48);

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
    expect(shape?.from).toBe(48);
    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape!.id]);

    expect(shape?.transform?.width).toBeCloseTo(100);
    expect(shape?.transform?.height).toBeCloseTo(60);
    expect(shape?.transform?.x).toBeCloseTo(-30);
    expect(shape?.transform?.y).toBeCloseTo(-10);
    expect(shape?.pathVertices?.[0]?.position).toEqual([0, 0]);
    expect(shape?.pathVertices?.[1]?.position).toEqual([1, 0]);
    expect(shape?.pathVertices?.[2]?.position).toEqual([1, 1]);
  });

  it('uses an existing top track before creating a new one', async () => {
    useMaskEditorStore.getState().startShapePenMode();
    usePlaybackStore.getState().setCurrentFrame(120);
    useSelectionStore.getState().setActiveTrack('track-2');
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
      {
        id: 'track-2',
        name: 'Track 2',
        height: 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'busy-mask-track',
        type: 'shape',
        trackId: 'track-2',
        from: 100,
        durationInFrames: 120,
        label: 'Busy',
        shapeType: 'rectangle',
        fillColor: '#ffffff',
      },
    ]);

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

    const shape = useItemsStore.getState().items.find((item) => item.id !== 'busy-mask-track');
    expect(shape?.trackId).toBe('track-1');
    expect(shape?.from).toBe(120);
    expect(useSelectionStore.getState().activeTrackId).toBe('track-1');
  });

  it('creates a new top track instead of placing the mask on a lower free track', async () => {
    useMaskEditorStore.getState().startShapePenMode();
    usePlaybackStore.getState().setCurrentFrame(120);
    useSelectionStore.getState().setActiveTrack('track-1');
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
      {
        id: 'track-2',
        name: 'Track 2',
        height: 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'busy-mask-track',
        type: 'shape',
        trackId: 'track-1',
        from: 100,
        durationInFrames: 120,
        label: 'Busy',
        shapeType: 'rectangle',
        fillColor: '#ffffff',
      },
    ]);

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

    const tracks = useItemsStore.getState().tracks;
    expect(tracks).toHaveLength(3);

    const newTrack = tracks.find((track) => track.id !== 'track-1' && track.id !== 'track-2');
    const shape = useItemsStore.getState().items.find((item) => item.id !== 'busy-mask-track');

    expect(newTrack).toBeDefined();
    expect(newTrack?.name).toBe('Track 3');
    expect(newTrack?.order).toBeLessThan(0);
    expect(shape?.trackId).toBe(newTrack?.id);
    expect(shape?.from).toBe(120);
    expect(useSelectionStore.getState().activeTrackId).toBe(newTrack?.id ?? null);
  });

  it('creates a new track to keep the mask at the playhead when all tracks are occupied', async () => {
    useMaskEditorStore.getState().startShapePenMode();
    usePlaybackStore.getState().setCurrentFrame(120);
    useSelectionStore.getState().setActiveTrack('track-1');
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
      {
        id: 'track-2',
        name: 'Track 2',
        height: 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]);
    useItemsStore.getState().setItems([
      {
        id: 'busy-track-1',
        type: 'shape',
        trackId: 'track-1',
        from: 100,
        durationInFrames: 120,
        label: 'Busy 1',
        shapeType: 'rectangle',
        fillColor: '#ffffff',
      },
      {
        id: 'busy-track-2',
        type: 'shape',
        trackId: 'track-2',
        from: 110,
        durationInFrames: 120,
        label: 'Busy 2',
        shapeType: 'rectangle',
        fillColor: '#ffffff',
      },
    ]);

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

    const tracks = useItemsStore.getState().tracks;
    expect(tracks).toHaveLength(3);

    const newTrack = tracks.find((track) => track.id !== 'track-1' && track.id !== 'track-2');
    const shape = useItemsStore.getState().items.find(
      (item) => item.id !== 'busy-track-1' && item.id !== 'busy-track-2'
    );

    expect(newTrack).toBeDefined();
    expect(newTrack?.name).toBe('Track 3');
    expect(shape?.trackId).toBe(newTrack?.id);
    expect(shape?.from).toBe(120);
    expect(useSelectionStore.getState().activeTrackId).toBe(newTrack?.id ?? null);
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

  it('does not turn a newly planted point into a bezier on tiny pointer movement', async () => {
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

    fireEvent.pointerDown(canvas!, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 45, clientY: 44, pointerId: 1 });
    fireEvent.pointerUp(canvas!, { clientX: 45, clientY: 44, pointerId: 1 });

    const firstVertex = useMaskEditorStore.getState().penVertices[0];
    expect(firstVertex?.inHandle).toEqual([0, 0]);
    expect(firstVertex?.outHandle).toEqual([0, 0]);
  });

  it('auto-closes the shape when the preview pen toolbar requests finish', async () => {
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

    act(() => {
      useMaskEditorStore.getState().requestFinishPenMode();
    });

    await waitFor(() => {
      expect(useMaskEditorStore.getState().isEditing).toBe(false);
    });

    const shape = useItemsStore.getState().items[0];
    expect(shape?.type).toBe('shape');
    expect(shape?.shapeType).toBe('path');
    expect(shape?.isMask).toBe(true);
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

  it('swallows unrelated shortcuts while pen mode is active', () => {
    useMaskEditorStore.getState().startShapePenMode();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={FULL_CANVAS_TRANSFORM}
      />
    );

    const bubbleListener = vi.fn();
    window.addEventListener('keydown', bubbleListener);

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'v',
        bubbles: true,
        cancelable: true,
      });
      const dispatchResult = window.dispatchEvent(event);

      expect(dispatchResult).toBe(false);
      expect(bubbleListener).not.toHaveBeenCalled();
      expect(useMaskEditorStore.getState().penMode).toBe(true);
    } finally {
      window.removeEventListener('keydown', bubbleListener);
    }
  });
});

describe('MaskEditorOverlay edit mode', () => {
  beforeEach(() => {
    resetStores();
  });

  function seedEditablePath() {
    useItemsStore.getState().setItems([
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        isMask: true,
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: { ...PATH_ITEM_TRANSFORM },
      },
    ]);
    useMaskEditorStore.getState().startEditing('path-1');
  }

  it('shows a crosshair cursor when hovering a path point', async () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    fireEvent.pointerMove(canvas!, { clientX: 50, clientY: 30, pointerId: 1 });

    await waitFor(() => {
      expect(canvas?.style.cursor).toBe('crosshair');
    });
  });

  it('shows a move cursor and insertion cue for editable path targets', async () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    mockCanvasContext.arc.mockClear();
    fireEvent.pointerMove(canvas!, { clientX: 100, clientY: 60, pointerId: 1 });

    await waitFor(() => {
      expect(canvas?.style.cursor).toBe('move');
    });

    mockCanvasContext.arc.mockClear();
    fireEvent.pointerMove(canvas!, { clientX: 150, clientY: 60, pointerId: 1 });

    await waitFor(() => {
      expect(
        mockCanvasContext.arc.mock.calls.some((call) =>
          Math.abs(call[2] - 4) < 0.1
        )
      ).toBe(true);
    });
    expect(canvas?.style.cursor).toBe('crosshair');
  });

  it('adds a point when double-clicking a path edge', () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    fireEvent.doubleClick(canvas!, { clientX: 150, clientY: 60 });

    const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
    expect(updatedItem?.pathVertices).toHaveLength(5);
    expect(updatedItem?.pathVertices?.[2]?.position).toEqual([1, 0.5]);
  });

  it('draws a visible selection ring for selected points', async () => {
    seedEditablePath();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    mockCanvasContext.arc.mockClear();

    act(() => {
      useMaskEditorStore.getState().selectVertex(1);
    });

    await waitFor(() => {
      expect(
        mockCanvasContext.arc.mock.calls.some((call) =>
          Math.abs(call[2] - 8) < 0.1
        )
      ).toBe(true);
    });
  });

  it('box-selects multiple points and converts them together', async () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    mockCanvasContext.rect.mockClear();
    fireEvent.pointerDown(canvas!, { clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 160, clientY: 100, pointerId: 1 });

    await waitFor(() => {
      expect(useMaskEditorStore.getState().selectedVertexIndices).toEqual([0, 1, 2, 3]);
      expect(mockCanvasContext.rect).toHaveBeenCalled();
    });

    fireEvent.pointerUp(canvas!, { clientX: 160, clientY: 100, pointerId: 1 });

    act(() => {
      useMaskEditorStore.getState().requestConvertSelectedVertex('bezier');
    });

    await waitFor(() => {
      const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
      expect(updatedItem?.pathVertices).toBeTruthy();
      expect(
        updatedItem?.pathVertices?.every((vertex) =>
          Math.hypot(vertex.inHandle[0], vertex.inHandle[1]) > 0.01
          && Math.hypot(vertex.outHandle[0], vertex.outHandle[1]) > 0.01
        )
      ).toBe(true);
    });
  });

  it('converts the selected point to a bezier knot when requested', async () => {
    seedEditablePath();

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    act(() => {
      useMaskEditorStore.getState().selectVertex(1);
      useMaskEditorStore.getState().requestConvertSelectedVertex('bezier');
    });

    await waitFor(() => {
      const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
      const convertedVertex = updatedItem?.pathVertices?.[1];
      expect(convertedVertex).toBeTruthy();
      expect(Math.hypot(
        convertedVertex!.inHandle[0],
        convertedVertex!.inHandle[1]
      )).toBeGreaterThan(0.01);
      expect(Math.hypot(
        convertedVertex!.outHandle[0],
        convertedVertex!.outHandle[1]
      )).toBeGreaterThan(0.01);
      expect(useMaskEditorStore.getState().selectedVertexIndex).toBe(1);
    });
  });

  it('converts the selected point to a corner knot when requested', async () => {
    useItemsStore.getState().setItems([
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        isMask: true,
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0], inHandle: [-0.2, 0], outHandle: [-0.15, 0.2] },
          { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: { ...PATH_ITEM_TRANSFORM },
      },
    ]);
    useMaskEditorStore.getState().startEditing('path-1');

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    act(() => {
      useMaskEditorStore.getState().selectVertex(1);
      useMaskEditorStore.getState().requestConvertSelectedVertex('corner');
    });

    await waitFor(() => {
      const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
      expect(updatedItem?.pathVertices?.[1]?.inHandle).toEqual([0, 0]);
      expect(updatedItem?.pathVertices?.[1]?.outHandle).toEqual([0, 0]);
    });
  });

  it('moves the whole path when dragging inside the shape body', () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    act(() => {
      useMaskEditorStore.getState().selectVertices([0, 1, 2, 3], 3);
    });

    fireEvent.pointerDown(canvas!, { clientX: 100, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 120, clientY: 75, pointerId: 1 });

    const itemDuringDrag = useItemsStore.getState().items.find((item) => item.id === 'path-1');
    expect(itemDuringDrag?.transform?.x).toBe(0);
    expect(itemDuringDrag?.transform?.y).toBe(0);
    expect(useMaskEditorStore.getState().selectedVertexIndices).toEqual([0, 1, 2, 3]);
    expect(useGizmoStore.getState().activeGizmo?.itemId).toBe('path-1');
    expect(useGizmoStore.getState().previewTransform?.x).toBeCloseTo(20);
    expect(useGizmoStore.getState().previewTransform?.y).toBeCloseTo(15);

    fireEvent.pointerUp(canvas!, { clientX: 120, clientY: 75, pointerId: 1 });

    const movedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
    expect(movedItem?.transform?.x).toBeCloseTo(20);
    expect(movedItem?.transform?.y).toBeCloseTo(15);
    expect(movedItem?.pathVertices).toEqual([
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [0, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ]);
    expect(useMaskEditorStore.getState().selectedVertexIndices).toEqual([0, 1, 2, 3]);
  });

  it('updates current-frame transform keyframes instead of baking animated bounds into the base mask transform', () => {
    const animatedTransform: Transform = {
      x: 30,
      y: 10,
      width: 120,
      height: 80,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    useItemsStore.getState().setItems([
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        isMask: true,
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0.5], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0.25, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: {
          x: 10,
          y: 5,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
      },
    ]);
    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'path-1',
          properties: [
            { property: 'x', keyframes: [{ id: 'x-kf', frame: 15, value: 30, easing: 'linear' }] },
            { property: 'y', keyframes: [{ id: 'y-kf', frame: 15, value: 10, easing: 'linear' }] },
            { property: 'width', keyframes: [{ id: 'width-kf', frame: 15, value: 120, easing: 'linear' }] },
            { property: 'height', keyframes: [{ id: 'height-kf', frame: 15, value: 80, easing: 'linear' }] },
          ],
        },
      ],
    });
    usePlaybackStore.getState().setCurrentFrame(15);
    useMaskEditorStore.getState().startEditing('path-1');

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
        itemTransform={animatedTransform}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    fireEvent.pointerDown(canvas!, { clientX: 70, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });
    fireEvent.pointerUp(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });

    const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
    expect(updatedItem?.transform?.x).toBeCloseTo(10);
    expect(updatedItem?.transform?.y).toBeCloseTo(5);
    expect(updatedItem?.transform?.width).toBeCloseTo(100);
    expect(updatedItem?.transform?.height).toBeCloseTo(60);

    const updatedKeyframes = useTimelineStore.getState().keyframes.find((entry) => entry.itemId === 'path-1');
    const xKeyframe = updatedKeyframes?.properties.find((property) => property.property === 'x')?.keyframes[0];
    const yKeyframe = updatedKeyframes?.properties.find((property) => property.property === 'y')?.keyframes[0];
    const widthKeyframe = updatedKeyframes?.properties.find((property) => property.property === 'width')?.keyframes[0];
    const heightKeyframe = updatedKeyframes?.properties.find((property) => property.property === 'height')?.keyframes[0];

    expect(xKeyframe?.value).toBeCloseTo(36);
    expect(yKeyframe?.value).toBeCloseTo(14);
    expect(widthKeyframe?.value).toBeCloseTo(108);
    expect(heightKeyframe?.value).toBeCloseTo(72);
  });

  it('adds current-frame transform keyframes for animated mask point edits between existing keys', () => {
    const animatedTransform: Transform = {
      x: 30,
      y: 10,
      width: 120,
      height: 80,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    useItemsStore.getState().setItems([
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 90,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        isMask: true,
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0.5], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0.25, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: {
          x: 10,
          y: 5,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
      },
    ]);
    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'path-1',
          properties: [
            {
              property: 'x',
              keyframes: [
                { id: 'x-kf-1', frame: 0, value: 10, easing: 'linear' },
                { id: 'x-kf-2', frame: 30, value: 50, easing: 'linear' },
              ],
            },
            {
              property: 'y',
              keyframes: [
                { id: 'y-kf-1', frame: 0, value: 5, easing: 'linear' },
                { id: 'y-kf-2', frame: 30, value: 15, easing: 'linear' },
              ],
            },
            {
              property: 'width',
              keyframes: [
                { id: 'width-kf-1', frame: 0, value: 100, easing: 'linear' },
                { id: 'width-kf-2', frame: 30, value: 140, easing: 'linear' },
              ],
            },
            {
              property: 'height',
              keyframes: [
                { id: 'height-kf-1', frame: 0, value: 60, easing: 'linear' },
                { id: 'height-kf-2', frame: 30, value: 100, easing: 'linear' },
              ],
            },
          ],
        },
      ],
    });
    usePlaybackStore.getState().setCurrentFrame(15);
    useMaskEditorStore.getState().startEditing('path-1');

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
        itemTransform={animatedTransform}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    fireEvent.pointerDown(canvas!, { clientX: 70, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });
    fireEvent.pointerUp(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });

    const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
    expect(updatedItem?.transform?.x).toBeCloseTo(10);
    expect(updatedItem?.transform?.y).toBeCloseTo(5);
    expect(updatedItem?.transform?.width).toBeCloseTo(100);
    expect(updatedItem?.transform?.height).toBeCloseTo(60);

    const updatedKeyframes = useTimelineStore.getState().keyframes.find((entry) => entry.itemId === 'path-1');
    const xKeyframes = updatedKeyframes?.properties.find((property) => property.property === 'x')?.keyframes ?? [];
    const yKeyframes = updatedKeyframes?.properties.find((property) => property.property === 'y')?.keyframes ?? [];
    const widthKeyframes = updatedKeyframes?.properties.find((property) => property.property === 'width')?.keyframes ?? [];
    const heightKeyframes = updatedKeyframes?.properties.find((property) => property.property === 'height')?.keyframes ?? [];

    expect(xKeyframes).toHaveLength(3);
    expect(yKeyframes).toHaveLength(3);
    expect(widthKeyframes).toHaveLength(3);
    expect(heightKeyframes).toHaveLength(3);

    expect(xKeyframes.find((keyframe) => keyframe.frame === 15)?.value).toBeCloseTo(36);
    expect(yKeyframes.find((keyframe) => keyframe.frame === 15)?.value).toBeCloseTo(14);
    expect(widthKeyframes.find((keyframe) => keyframe.frame === 15)?.value).toBeCloseTo(108);
    expect(heightKeyframes.find((keyframe) => keyframe.frame === 15)?.value).toBeCloseTo(72);
  });

  it('falls back to base transform when frame is in a transition region and keyframe add is blocked', () => {
    const animatedTransform: Transform = {
      x: 30,
      y: 10,
      width: 120,
      height: 80,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    };

    useItemsStore.getState().setItems([
      {
        id: 'left-clip',
        type: 'shape',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: 'Left',
        shapeType: 'rectangle',
        fillColor: '#000000',
        transform: { x: 0, y: 0, width: 200, height: 120, rotation: 0, opacity: 1, cornerRadius: 0 },
      },
      {
        id: 'path-1',
        type: 'shape',
        trackId: 'track-1',
        from: 20,
        durationInFrames: 60,
        label: 'Mask',
        shapeType: 'path',
        fillColor: '#ffffff',
        isMask: true,
        pathVertices: [
          { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [1, 0.5], inHandle: [0, 0], outHandle: [0, 0] },
          { position: [0.25, 1], inHandle: [0, 0], outHandle: [0, 0] },
        ],
        transform: {
          x: 10,
          y: 5,
          width: 100,
          height: 60,
          rotation: 0,
          opacity: 1,
          cornerRadius: 0,
        },
      },
    ]);

    // Transition covering frames 0-10 of path-1 (incoming clip)
    useTransitionsStore.getState().setTransitions([
      {
        id: 'trans-1',
        type: 'crossfade',
        presentation: 'fade',
        timing: 'linear',
        leftClipId: 'left-clip',
        rightClipId: 'path-1',
        trackId: 'track-1',
        durationInFrames: 10,
        alignment: 0,
      },
    ]);

    useTimelineStore.setState({
      keyframes: [
        {
          itemId: 'path-1',
          properties: [
            { property: 'x', keyframes: [{ id: 'x-kf', frame: 30, value: 50, easing: 'linear' }] },
            { property: 'y', keyframes: [{ id: 'y-kf', frame: 30, value: 20, easing: 'linear' }] },
            { property: 'width', keyframes: [{ id: 'w-kf', frame: 30, value: 140, easing: 'linear' }] },
            { property: 'height', keyframes: [{ id: 'h-kf', frame: 30, value: 100, easing: 'linear' }] },
          ],
        },
      ],
    });

    // Frame 25 in project = frame 5 in item (inside transition region)
    usePlaybackStore.getState().setCurrentFrame(25);
    useMaskEditorStore.getState().startEditing('path-1');

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
        itemTransform={animatedTransform}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    fireEvent.pointerDown(canvas!, { clientX: 70, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });
    fireEvent.pointerUp(canvas!, { clientX: 82, clientY: 38, pointerId: 1 });

    const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');

    // The edit should fall through to base transform since keyframe add is blocked
    expect(updatedItem?.transform?.x).not.toBeCloseTo(10);
    expect(updatedItem?.transform?.y).not.toBeCloseTo(5);

    // Keyframe count should NOT have increased — no new keyframes in transition region
    const updatedKeyframes = useTimelineStore.getState().keyframes.find((entry) => entry.itemId === 'path-1');
    const xKeyframes = updatedKeyframes?.properties.find((property) => property.property === 'x')?.keyframes ?? [];
    expect(xKeyframes).toHaveLength(1);
  });

  it('keeps the current multi-selection while dragging a selected point', () => {
    seedEditablePath();

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
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();

    vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

    act(() => {
      useMaskEditorStore.getState().selectVertices([0, 1, 2, 3], 1);
    });

    fireEvent.pointerDown(canvas!, { clientX: 150, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientX: 165, clientY: 30, pointerId: 1 });

    expect(useMaskEditorStore.getState().selectedVertexIndices).toEqual([0, 1, 2, 3]);
    expect(useMaskEditorStore.getState().selectedVertexIndex).toBe(1);
  });

  it('deletes the selected point instead of deleting the whole path item', async () => {
    seedEditablePath();
    useSelectionStore.getState().selectItems(['path-1']);

    const coordParams: CoordinateParams = {
      containerRect: createRect(),
      playerSize: PLAYER_SIZE,
      projectSize: PROJECT_SIZE,
      zoom: 1,
    };

    render(
      <MaskEditorOverlay
        coordParams={coordParams}
        playerSize={PLAYER_SIZE}
        itemTransform={PATH_ITEM_TRANSFORM}
      />
    );

    act(() => {
      useMaskEditorStore.getState().selectVertex(1);
    });

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => {
      const updatedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
      expect(updatedItem).toBeDefined();
      expect(updatedItem?.pathVertices).toHaveLength(3);
      expect(updatedItem?.pathVertices?.[0]?.position).toEqual([0, 0]);
      expect(updatedItem?.pathVertices?.[1]?.position).toEqual([1, 1]);
      expect(updatedItem?.pathVertices?.[2]?.position).toEqual([0, 1]);
    });
  });

  it('keeps the dragged vertex stable while the fitted transform catches up after release', async () => {
    const queuedRafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queuedRafCallbacks.push(callback);
      return queuedRafCallbacks.length;
    });
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      const index = Number(id) - 1;
      if (index >= 0 && index < queuedRafCallbacks.length) {
        queuedRafCallbacks[index] = () => 0;
      }
    });

    try {
      seedEditablePath();

      const coordParams: CoordinateParams = {
        containerRect: createRect(),
        playerSize: PLAYER_SIZE,
        projectSize: PROJECT_SIZE,
        zoom: 1,
      };

      const { container, rerender } = render(
        <MaskEditorOverlay
          coordParams={coordParams}
          playerSize={PLAYER_SIZE}
          itemTransform={PATH_ITEM_TRANSFORM}
        />
      );

      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();

      vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue(createRect());

      fireEvent.pointerDown(canvas!, { clientX: 150, clientY: 30, pointerId: 1 });
      fireEvent.pointerMove(canvas!, { clientX: 170, clientY: 30, pointerId: 1 });
      fireEvent.pointerUp(canvas!, { clientX: 170, clientY: 30, pointerId: 1 });

      const committedItem = useItemsStore.getState().items.find((item) => item.id === 'path-1');
      const committedTransform: Transform = {
        x: committedItem?.transform?.x ?? 0,
        y: committedItem?.transform?.y ?? 0,
        width: committedItem?.transform?.width ?? PATH_ITEM_TRANSFORM.width,
        height: committedItem?.transform?.height ?? PATH_ITEM_TRANSFORM.height,
        rotation: committedItem?.transform?.rotation ?? 0,
        opacity: committedItem?.transform?.opacity ?? 1,
        cornerRadius: committedItem?.transform?.cornerRadius ?? 0,
      };

      mockCanvasContext.arc.mockClear();

      rerender(
        <MaskEditorOverlay
          coordParams={coordParams}
          playerSize={PLAYER_SIZE}
          itemTransform={committedTransform}
        />
      );

      act(() => {
        useMaskEditorStore.getState().setHover(0, null);
      });

      await waitFor(() => {
        expect(mockCanvasContext.arc.mock.calls.length).toBeGreaterThan(0);
      });

      const hasVertexAtDraggedPosition = mockCanvasContext.arc.mock.calls.some((call) =>
        Math.abs(call[0] - 170) < 0.1 && Math.abs(call[1] - 30) < 0.1
      );
      const hasVertexAtSnappedPosition = mockCanvasContext.arc.mock.calls.some((call) =>
        Math.abs(call[0] - 194) < 0.1 && Math.abs(call[1] - 30) < 0.1
      );

      expect(hasVertexAtDraggedPosition).toBe(true);
      expect(hasVertexAtSnappedPosition).toBe(false);
    } finally {
      rafSpy.mockRestore();
      cancelRafSpy.mockRestore();
    }
  });
});
