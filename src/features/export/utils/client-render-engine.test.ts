import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const gpuMocks = vi.hoisted(() => {
  const copyExternalImageToTextureMock = vi.fn();
  const configureCanvasMock = vi.fn(() => ({ label: 'gpu-canvas-context' }));
  const compositeToCanvasMock = vi.fn(() => true);
  const textureView = { label: 'texture-view' };
  const texture = {
    createView: vi.fn(() => textureView),
  };
  const device = {
    queue: {
      copyExternalImageToTexture: copyExternalImageToTextureMock,
    },
  };
  const pipeline = {
    getDevice: vi.fn(() => device),
    configureCanvas: configureCanvasMock,
    destroy: vi.fn(),
    isBatching: vi.fn(() => false),
    applyEffectsToCanvas: vi.fn(),
    renderVideoToCanvas: vi.fn(),
    applyEffectsToVideo: vi.fn(),
  };
  const createEffectsPipelineMock = vi.fn(async () => pipeline);
  const requestCachedDeviceMock = vi.fn(async () => device);
  const texturePoolAcquireMock = vi.fn(() => texture);
  const texturePoolReleaseMock = vi.fn();
  const fallbackMaskView = { label: 'fallback-mask-view' };
  const getFallbackViewMock = vi.fn(() => fallbackMaskView);
  const transitionDestroyMock = vi.fn();
  const createTransitionPipelineMock = vi.fn(() => ({ destroy: transitionDestroyMock }));

  return {
    copyExternalImageToTextureMock,
    configureCanvasMock,
    compositeToCanvasMock,
    createEffectsPipelineMock,
    requestCachedDeviceMock,
    texturePoolAcquireMock,
    texturePoolReleaseMock,
    getFallbackViewMock,
    createTransitionPipelineMock,
    transitionDestroyMock,
    texture,
    textureView,
    fallbackMaskView,
    pipeline,
  };
});

vi.mock('@/infrastructure/gpu/effects', () => ({
  EffectsPipeline: {
    create: gpuMocks.createEffectsPipelineMock,
    requestCachedDevice: gpuMocks.requestCachedDeviceMock,
  },
}));

vi.mock('@/infrastructure/gpu/transitions', () => ({
  TransitionPipeline: {
    create: gpuMocks.createTransitionPipelineMock,
  },
}));

vi.mock('@/infrastructure/gpu/compositor', () => ({
  DEFAULT_LAYER_PARAMS: {},
  CompositorPipeline: class {
    compositeToCanvas = gpuMocks.compositeToCanvasMock;
    destroy = vi.fn();
  },
  GpuTexturePool: class {
    acquire = gpuMocks.texturePoolAcquireMock;
    release = gpuMocks.texturePoolReleaseMock;
    destroy = vi.fn();
  },
}));

vi.mock('@/infrastructure/gpu/masks', () => ({
  MaskTextureManager: class {
    getFallbackView = gpuMocks.getFallbackViewMock;
    destroy = vi.fn();
  },
}));

import { createCompositionRenderer } from './client-render-engine';

type Mock2DContext = OffscreenCanvasRenderingContext2D & {
  canvas: MockOffscreenCanvas;
  fillRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

function createMock2DContext(canvas: MockOffscreenCanvas): Mock2DContext {
  return {
    canvas,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    measureText: vi.fn(() => ({
      width: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as Mock2DContext;
}

class MockOffscreenCanvas {
  static instances: MockOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: Mock2DContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = createMock2DContext(this);
    MockOffscreenCanvas.instances.push(this);
  }

  getContext(type: string): Mock2DContext | null {
    return type === '2d' ? this.ctx : null;
  }
}

describe('client-render-engine direct GPU presentation', () => {
  beforeAll(() => {
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  });

  beforeEach(() => {
    MockOffscreenCanvas.instances.length = 0;
    gpuMocks.copyExternalImageToTextureMock.mockReset();
    gpuMocks.configureCanvasMock.mockClear();
    gpuMocks.compositeToCanvasMock.mockClear();
    gpuMocks.createEffectsPipelineMock.mockClear();
    gpuMocks.requestCachedDeviceMock.mockClear();
    gpuMocks.texturePoolAcquireMock.mockClear();
    gpuMocks.texturePoolReleaseMock.mockClear();
    gpuMocks.getFallbackViewMock.mockClear();
    gpuMocks.createTransitionPipelineMock.mockClear();
    gpuMocks.transitionDestroyMock.mockClear();
    gpuMocks.pipeline.getDevice.mockClear();
    gpuMocks.pipeline.configureCanvas.mockClear();
    gpuMocks.pipeline.destroy.mockClear();
    gpuMocks.pipeline.isBatching.mockClear();
    gpuMocks.pipeline.applyEffectsToCanvas.mockClear();
    gpuMocks.pipeline.renderVideoToCanvas.mockClear();
    gpuMocks.pipeline.applyEffectsToVideo.mockClear();
    gpuMocks.texture.createView.mockClear();
  });

  it('presents the fully composed render canvas instead of the pooled scene buffer', async () => {
    const renderCanvas = new MockOffscreenCanvas(640, 360) as unknown as OffscreenCanvas;
    const renderCtx = (renderCanvas as unknown as MockOffscreenCanvas).getContext('2d');
    const presentationCanvas = new MockOffscreenCanvas(640, 360) as unknown as OffscreenCanvas;

    const renderer = await createCompositionRenderer(
      {
        fps: 30,
        tracks: [],
        transitions: [],
        backgroundColor: '#ff0000',
        keyframes: [],
      },
      renderCanvas,
      renderCtx!,
      {
        mode: 'export',
        presentationCanvas,
      },
    );

    await renderer.warmGpuPipeline();
    await renderer.renderFrame(0);

    const presentedSource = gpuMocks.copyExternalImageToTextureMock.mock.calls.at(-1)?.[0]?.source;
    expect(presentedSource).toBe(renderCanvas);
    expect(renderer.wasLastFramePresentedDirectly()).toBe(true);
    expect(renderer.getDirectGpuPresentationCount()).toBe(1);

    const pooledCanvases = MockOffscreenCanvas.instances.filter(
      (canvas) => canvas !== renderCanvas && canvas !== presentationCanvas,
    );
    expect(pooledCanvases.length).toBeGreaterThan(0);
    expect(pooledCanvases.some((canvas) => (
      canvas.ctx.fillStyle === '#ff0000'
      && canvas.ctx.fillRect.mock.calls.some((args) => (
        args[0] === 0
        && args[1] === 0
        && args[2] === 640
        && args[3] === 360
      ))
    ))).toBe(true);
  });
});
