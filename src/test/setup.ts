import '@testing-library/jest-dom';
import { vi } from 'vitest';

type TestGlobals = typeof globalThis & {
  ImageData?: new (
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number
  ) => {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
  GPUShaderStage?: {
    VERTEX: number;
    FRAGMENT: number;
    COMPUTE: number;
  };
  GPUTextureUsage?: {
    COPY_SRC: number;
    COPY_DST: number;
    TEXTURE_BINDING: number;
    STORAGE_BINDING: number;
    RENDER_ATTACHMENT: number;
  };
  GPUBufferUsage?: {
    MAP_READ: number;
    MAP_WRITE: number;
    COPY_SRC: number;
    COPY_DST: number;
    INDEX: number;
    VERTEX: number;
    UNIFORM: number;
    STORAGE: number;
    INDIRECT: number;
    QUERY_RESOLVE: number;
  };
  GPUMapMode?: {
    READ: number;
    WRITE: number;
  };
};

const testGlobals = globalThis as TestGlobals;

// Mock ImageData for Canvas operations
if (typeof testGlobals.ImageData === 'undefined') {
  testGlobals.ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;

    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      height?: number
    ) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? Math.floor(dataOrWidth.length / (widthOrHeight * 4));
      }
    }
  };
}

// Mock GPUShaderStage for WebGPU
if (typeof testGlobals.GPUShaderStage === 'undefined') {
  testGlobals.GPUShaderStage = {
    VERTEX: 1,
    FRAGMENT: 2,
    COMPUTE: 4,
  };
}

// Mock GPUTextureUsage for WebGPU
if (typeof testGlobals.GPUTextureUsage === 'undefined') {
  testGlobals.GPUTextureUsage = {
    COPY_SRC: 1,
    COPY_DST: 2,
    TEXTURE_BINDING: 4,
    STORAGE_BINDING: 8,
    RENDER_ATTACHMENT: 16,
  };
}

// Mock GPUBufferUsage for WebGPU
if (typeof testGlobals.GPUBufferUsage === 'undefined') {
  testGlobals.GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
}

// Mock GPUMapMode for WebGPU
if (typeof testGlobals.GPUMapMode === 'undefined') {
  testGlobals.GPUMapMode = {
    READ: 1,
    WRITE: 2,
  };
}

// Mock WebGPU API for testing
const mockGPUAdapter = {
  requestDevice: vi.fn().mockResolvedValue({
    createShaderModule: vi.fn(),
    createBindGroupLayout: vi.fn(),
    createPipelineLayout: vi.fn(),
    createRenderPipeline: vi.fn(),
    createBuffer: vi.fn(),
    createTexture: vi.fn(),
    createSampler: vi.fn(),
    createCommandEncoder: vi.fn(),
    queue: {
      submit: vi.fn(),
      writeBuffer: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
    },
    destroy: vi.fn(),
    limits: { maxTextureDimension2D: 8192 },
  }),
  features: new Set(),
  limits: {},
};

Object.defineProperty(navigator, 'gpu', {
  value: {
    requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter),
    getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
  },
  writable: true,
});
