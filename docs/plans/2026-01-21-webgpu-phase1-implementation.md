# WebGPU Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish GPU rendering backend abstraction with WebGPU primary and WebGL2/Canvas fallbacks, rendering video frames to canvas.

**Architecture:** Create a `RenderBackend` interface that all backends implement, with automatic capability detection and fallback chain. The existing HTML5 player continues to work unchanged while the GPU path is added alongside it.

**Tech Stack:** WebGPU API, WebGL2, Canvas 2D, TypeScript, Vitest (new)

---

## Prerequisites

Before starting, ensure you have:
- Chrome 113+ or Edge 113+ for WebGPU testing
- The codebase running locally (`npm run dev`)

---

## Task 1: Set Up Vitest Testing Framework

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Modify: `package.json`

**Step 1: Install vitest and dependencies**

Run:
```bash
npm install -D vitest @testing-library/react @testing-library/dom jsdom @vitest/coverage-v8
```

Expected: Packages installed successfully

**Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 3: Create test setup file**

Create `src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom';

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
  }),
  features: new Set(),
  limits: {},
};

Object.defineProperty(navigator, 'gpu', {
  value: {
    requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter),
  },
  writable: true,
});
```

**Step 4: Add test script to package.json**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 5: Verify vitest runs**

Run: `npm run test:run`
Expected: "No test files found" (success - framework is set up)

**Step 6: Commit**

```bash
git add vitest.config.ts src/test/setup.ts package.json package-lock.json
git commit -m "chore: add vitest testing framework with WebGPU mocks"
```

---

## Task 2: Create RenderBackend Interface and Types

**Files:**
- Create: `src/features/gpu/backend/types.ts`
- Create: `src/features/gpu/backend/types.test.ts`

**Step 1: Write the test for types**

Create `src/features/gpu/backend/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
} from './types';

describe('RenderBackend types', () => {
  it('should allow implementing RenderBackend interface', () => {
    // This test verifies the interface is correctly defined
    // by creating a mock implementation
    const mockBackend: RenderBackend = {
      name: 'webgpu',
      capabilities: {
        maxTextureSize: 8192,
        supportsFloat16: true,
        supportsComputeShaders: true,
        supportsExternalTextures: true,
        maxColorAttachments: 8,
      },
      init: async () => {},
      destroy: () => {},
      createTexture: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      uploadPixels: () => {},
      importVideoFrame: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      importImageBitmap: () => ({ id: '1', width: 100, height: 100, format: 'rgba8unorm' }),
      beginFrame: () => {},
      endFrame: () => {},
      renderToScreen: () => {},
      renderToTexture: () => {},
      readPixels: async () => new Uint8Array(0),
    };

    expect(mockBackend.name).toBe('webgpu');
    expect(mockBackend.capabilities.maxTextureSize).toBe(8192);
  });

  it('should support all texture formats', () => {
    const formats: TextureFormat[] = ['rgba8unorm', 'rgba16float', 'rgba32float', 'bgra8unorm'];
    expect(formats).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/types.test.ts`
Expected: FAIL - Cannot find module './types'

**Step 3: Create the types file**

Create `src/features/gpu/backend/types.ts`:
```typescript
/**
 * GPU Backend Types
 *
 * Defines the abstraction layer for WebGPU, WebGL2, and Canvas rendering backends.
 */

/**
 * Supported backend names
 */
export type BackendName = 'webgpu' | 'webgl2' | 'canvas';

/**
 * Supported texture formats
 */
export type TextureFormat = 'rgba8unorm' | 'rgba16float' | 'rgba32float' | 'bgra8unorm';

/**
 * Handle to a GPU texture resource
 */
export interface TextureHandle {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
}

/**
 * Backend capability flags
 */
export interface BackendCapabilities {
  /** Maximum texture dimension in pixels */
  readonly maxTextureSize: number;
  /** Whether 16-bit float textures are supported */
  readonly supportsFloat16: boolean;
  /** Whether compute shaders are available (WebGPU only) */
  readonly supportsComputeShaders: boolean;
  /** Whether external video textures can be imported directly */
  readonly supportsExternalTextures: boolean;
  /** Maximum number of color attachments for render targets */
  readonly maxColorAttachments: number;
}

/**
 * Render pass descriptor for executing shader programs
 */
export interface RenderPassDescriptor {
  /** Shader program identifier */
  shader: string;
  /** Input textures */
  inputs: TextureHandle[];
  /** Output texture (null for screen) */
  output: TextureHandle | null;
  /** Uniform values */
  uniforms: Record<string, number | number[] | Float32Array>;
  /** Viewport dimensions (defaults to output size) */
  viewport?: { width: number; height: number };
}

/**
 * Abstract render backend interface
 *
 * All rendering backends (WebGPU, WebGL2, Canvas) implement this interface,
 * allowing the rendering code to be backend-agnostic.
 */
export interface RenderBackend {
  /** Backend identifier */
  readonly name: BackendName;

  /** Backend capabilities */
  readonly capabilities: BackendCapabilities;

  // === Lifecycle ===

  /**
   * Initialize the backend with a canvas element
   */
  init(canvas: HTMLCanvasElement): Promise<void>;

  /**
   * Clean up all resources
   */
  destroy(): void;

  // === Texture Management ===

  /**
   * Create an empty texture
   */
  createTexture(width: number, height: number, format: TextureFormat): TextureHandle;

  /**
   * Upload pixel data to a texture
   */
  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void;

  /**
   * Import a VideoFrame directly (zero-copy when possible)
   */
  importVideoFrame(frame: VideoFrame): TextureHandle;

  /**
   * Import an ImageBitmap
   */
  importImageBitmap(bitmap: ImageBitmap): TextureHandle;

  // === Rendering ===

  /**
   * Begin a new frame
   */
  beginFrame(): void;

  /**
   * End the current frame and present to screen
   */
  endFrame(): void;

  /**
   * Render a fullscreen quad with the given texture to the screen
   */
  renderToScreen(texture: TextureHandle): void;

  /**
   * Render to a texture (for multi-pass effects)
   */
  renderToTexture(pass: RenderPassDescriptor): void;

  // === Readback ===

  /**
   * Read pixels from a texture (for export)
   */
  readPixels(texture: TextureHandle): Promise<Uint8Array>;
}

/**
 * Options for creating a render backend
 */
export interface BackendOptions {
  /** Preferred backend (will fall back if not available) */
  preferredBackend?: BackendName;
  /** Enable debug logging */
  debug?: boolean;
  /** Power preference for GPU selection */
  powerPreference?: 'high-performance' | 'low-power';
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/backend/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/backend/types.ts src/features/gpu/backend/types.test.ts
git commit -m "feat(gpu): add RenderBackend interface and types"
```

---

## Task 3: Implement Backend Capability Detection

**Files:**
- Create: `src/features/gpu/backend/capabilities.ts`
- Create: `src/features/gpu/backend/capabilities.test.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/backend/capabilities.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectWebGPUSupport,
  detectWebGL2Support,
  detectBestBackend,
} from './capabilities';

describe('Backend Capabilities Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectWebGPUSupport', () => {
    it('should return true when WebGPU is available', async () => {
      const result = await detectWebGPUSupport();
      // Mock is set up in setup.ts
      expect(result).toBe(true);
    });

    it('should return false when navigator.gpu is undefined', async () => {
      const originalGpu = navigator.gpu;
      // @ts-expect-error - testing undefined case
      navigator.gpu = undefined;

      const result = await detectWebGPUSupport();
      expect(result).toBe(false);

      // Restore
      Object.defineProperty(navigator, 'gpu', { value: originalGpu, writable: true });
    });
  });

  describe('detectWebGL2Support', () => {
    it('should return true when WebGL2 is available', () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({}),
      } as unknown as HTMLCanvasElement;

      const result = detectWebGL2Support(mockCanvas);
      expect(result).toBe(true);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('webgl2');
    });

    it('should return false when WebGL2 is not available', () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(null),
      } as unknown as HTMLCanvasElement;

      const result = detectWebGL2Support(mockCanvas);
      expect(result).toBe(false);
    });
  });

  describe('detectBestBackend', () => {
    it('should return webgpu when available', async () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({}),
      } as unknown as HTMLCanvasElement;

      const result = await detectBestBackend(mockCanvas);
      expect(result).toBe('webgpu');
    });

    it('should return webgl2 when WebGPU unavailable but WebGL2 available', async () => {
      const originalGpu = navigator.gpu;
      // @ts-expect-error - testing undefined case
      navigator.gpu = undefined;

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({}),
      } as unknown as HTMLCanvasElement;

      const result = await detectBestBackend(mockCanvas);
      expect(result).toBe('webgl2');

      Object.defineProperty(navigator, 'gpu', { value: originalGpu, writable: true });
    });

    it('should return canvas as last resort', async () => {
      const originalGpu = navigator.gpu;
      // @ts-expect-error - testing undefined case
      navigator.gpu = undefined;

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(null),
      } as unknown as HTMLCanvasElement;

      const result = await detectBestBackend(mockCanvas);
      expect(result).toBe('canvas');

      Object.defineProperty(navigator, 'gpu', { value: originalGpu, writable: true });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/capabilities.test.ts`
Expected: FAIL - Cannot find module './capabilities'

**Step 3: Implement capabilities detection**

Create `src/features/gpu/backend/capabilities.ts`:
```typescript
/**
 * Backend Capability Detection
 *
 * Detects available rendering backends and their capabilities.
 */

import type { BackendName } from './types';

/**
 * Check if WebGPU is supported
 */
export async function detectWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Check if WebGL2 is supported
 */
export function detectWebGL2Support(canvas?: HTMLCanvasElement): boolean {
  const testCanvas = canvas ?? document.createElement('canvas');

  try {
    const gl = testCanvas.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * Check if Canvas 2D is supported (always true in browsers)
 */
export function detectCanvasSupport(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    return ctx !== null;
  } catch {
    return false;
  }
}

/**
 * Detect the best available backend
 * Priority: WebGPU > WebGL2 > Canvas
 */
export async function detectBestBackend(canvas?: HTMLCanvasElement): Promise<BackendName> {
  // Try WebGPU first
  if (await detectWebGPUSupport()) {
    return 'webgpu';
  }

  // Fall back to WebGL2
  if (detectWebGL2Support(canvas)) {
    return 'webgl2';
  }

  // Last resort: Canvas 2D
  return 'canvas';
}

/**
 * Get all available backends
 */
export async function getAvailableBackends(canvas?: HTMLCanvasElement): Promise<BackendName[]> {
  const available: BackendName[] = [];

  if (await detectWebGPUSupport()) {
    available.push('webgpu');
  }

  if (detectWebGL2Support(canvas)) {
    available.push('webgl2');
  }

  if (detectCanvasSupport()) {
    available.push('canvas');
  }

  return available;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/backend/capabilities.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/backend/capabilities.ts src/features/gpu/backend/capabilities.test.ts
git commit -m "feat(gpu): add backend capability detection"
```

---

## Task 4: Implement Canvas Backend (Simplest First)

**Files:**
- Create: `src/features/gpu/backend/canvas-backend.ts`
- Create: `src/features/gpu/backend/canvas-backend.test.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/backend/canvas-backend.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasBackend } from './canvas-backend';

describe('CanvasBackend', () => {
  let backend: CanvasBackend;
  let mockCanvas: HTMLCanvasElement;
  let mockContext: CanvasRenderingContext2D;

  beforeEach(() => {
    mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(100 * 100 * 4),
      }),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      canvas: { width: 1920, height: 1080 },
    } as unknown as CanvasRenderingContext2D;

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockContext),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    backend = new CanvasBackend();
  });

  describe('initialization', () => {
    it('should have correct name', () => {
      expect(backend.name).toBe('canvas');
    });

    it('should report limited capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(false);
      expect(backend.capabilities.supportsExternalTextures).toBe(false);
      expect(backend.capabilities.supportsFloat16).toBe(false);
    });

    it('should initialize with canvas', async () => {
      await backend.init(mockCanvas);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    });
  });

  describe('texture management', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should create texture with correct dimensions', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      expect(handle.width).toBe(100);
      expect(handle.height).toBe(100);
      expect(handle.format).toBe('rgba8unorm');
      expect(handle.id).toBeDefined();
    });

    it('should upload pixels to texture', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');
      const pixels = new Uint8Array(100 * 100 * 4);

      expect(() => backend.uploadPixels(handle, pixels)).not.toThrow();
    });
  });

  describe('rendering', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should render texture to screen', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      backend.beginFrame();
      backend.renderToScreen(handle);
      backend.endFrame();

      expect(mockContext.drawImage).toHaveBeenCalled();
    });
  });

  describe('readback', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should read pixels from texture', async () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');
      const pixels = await backend.readPixels(handle);

      expect(pixels).toBeInstanceOf(Uint8Array);
      expect(pixels.length).toBe(100 * 100 * 4);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/canvas-backend.test.ts`
Expected: FAIL - Cannot find module './canvas-backend'

**Step 3: Implement CanvasBackend**

Create `src/features/gpu/backend/canvas-backend.ts`:
```typescript
/**
 * Canvas 2D Render Backend
 *
 * Fallback backend using Canvas 2D API. Limited capabilities but works everywhere.
 */

import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
  RenderPassDescriptor,
} from './types';

interface CanvasTexture {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  format: TextureFormat;
}

/**
 * Canvas 2D rendering backend
 *
 * This is the fallback backend with the most limited capabilities.
 * It uses offscreen canvases for texture storage and Canvas 2D for rendering.
 */
export class CanvasBackend implements RenderBackend {
  readonly name = 'canvas' as const;

  readonly capabilities: BackendCapabilities = {
    maxTextureSize: 4096, // Conservative limit
    supportsFloat16: false,
    supportsComputeShaders: false,
    supportsExternalTextures: false,
    maxColorAttachments: 1,
  };

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private textures: Map<string, CanvasTexture> = new Map();
  private nextTextureId = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get Canvas 2D context');
    }

    this.ctx = ctx;
  }

  destroy(): void {
    this.textures.clear();
    this.canvas = null;
    this.ctx = null;
  }

  createTexture(width: number, height: number, format: TextureFormat): TextureHandle {
    const id = `canvas_tex_${this.nextTextureId++}`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create offscreen canvas context');
    }

    this.textures.set(id, { canvas, ctx, width, height, format });

    return { id, width, height, format };
  }

  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void {
    const texture = this.textures.get(handle.id);
    if (!texture) {
      throw new Error(`Texture not found: ${handle.id}`);
    }

    const imageData = new ImageData(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      texture.width,
      texture.height
    );

    texture.ctx.putImageData(imageData, 0, 0);
  }

  importVideoFrame(frame: VideoFrame): TextureHandle {
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const handle = this.createTexture(width, height, 'rgba8unorm');

    const texture = this.textures.get(handle.id)!;
    texture.ctx.drawImage(frame, 0, 0);

    return handle;
  }

  importImageBitmap(bitmap: ImageBitmap): TextureHandle {
    const handle = this.createTexture(bitmap.width, bitmap.height, 'rgba8unorm');

    const texture = this.textures.get(handle.id)!;
    texture.ctx.drawImage(bitmap, 0, 0);

    return handle;
  }

  beginFrame(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  endFrame(): void {
    // Canvas 2D presents immediately, nothing to do
  }

  renderToScreen(texture: TextureHandle): void {
    if (!this.ctx || !this.canvas) return;

    const tex = this.textures.get(texture.id);
    if (!tex) return;

    // Draw texture to main canvas, scaling to fit
    this.ctx.drawImage(
      tex.canvas,
      0, 0, tex.width, tex.height,
      0, 0, this.canvas.width, this.canvas.height
    );
  }

  renderToTexture(pass: RenderPassDescriptor): void {
    // Canvas backend has very limited multi-pass support
    // For now, just copy the first input to output
    if (!pass.output || pass.inputs.length === 0) return;

    const input = this.textures.get(pass.inputs[0].id);
    const output = this.textures.get(pass.output.id);

    if (!input || !output) return;

    output.ctx.drawImage(input.canvas, 0, 0);
  }

  async readPixels(texture: TextureHandle): Promise<Uint8Array> {
    const tex = this.textures.get(texture.id);
    if (!tex) {
      throw new Error(`Texture not found: ${texture.id}`);
    }

    const imageData = tex.ctx.getImageData(0, 0, tex.width, tex.height);
    return new Uint8Array(imageData.data.buffer);
  }

  /**
   * Release a texture
   */
  releaseTexture(handle: TextureHandle): void {
    this.textures.delete(handle.id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/backend/canvas-backend.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/backend/canvas-backend.ts src/features/gpu/backend/canvas-backend.test.ts
git commit -m "feat(gpu): implement Canvas 2D render backend"
```

---

## Task 5: Implement WebGL2 Backend

**Files:**
- Create: `src/features/gpu/backend/webgl2-backend.ts`
- Create: `src/features/gpu/backend/webgl2-backend.test.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/backend/webgl2-backend.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebGL2Backend } from './webgl2-backend';

describe('WebGL2Backend', () => {
  let backend: WebGL2Backend;
  let mockCanvas: HTMLCanvasElement;
  let mockGl: WebGL2RenderingContext;

  beforeEach(() => {
    mockGl = {
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texParameteri: vi.fn(),
      deleteTexture: vi.fn(),
      createFramebuffer: vi.fn().mockReturnValue({}),
      bindFramebuffer: vi.fn(),
      framebufferTexture2D: vi.fn(),
      createShader: vi.fn().mockReturnValue({}),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn().mockReturnValue(true),
      createProgram: vi.fn().mockReturnValue({}),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn().mockReturnValue(true),
      useProgram: vi.fn(),
      getUniformLocation: vi.fn().mockReturnValue({}),
      getAttribLocation: vi.fn().mockReturnValue(0),
      createBuffer: vi.fn().mockReturnValue({}),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      uniform1i: vi.fn(),
      viewport: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      drawArrays: vi.fn(),
      readPixels: vi.fn(),
      getParameter: vi.fn().mockReturnValue(8192),
      getExtension: vi.fn().mockReturnValue({}),
      TEXTURE_2D: 0x0DE1,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812F,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      FRAMEBUFFER: 0x8D40,
      COLOR_ATTACHMENT0: 0x8CE0,
      VERTEX_SHADER: 0x8B31,
      FRAGMENT_SHADER: 0x8B30,
      COMPILE_STATUS: 0x8B81,
      LINK_STATUS: 0x8B82,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88E4,
      FLOAT: 0x1406,
      TRIANGLE_STRIP: 0x0005,
      COLOR_BUFFER_BIT: 0x4000,
      MAX_TEXTURE_SIZE: 0x0D33,
    } as unknown as WebGL2RenderingContext;

    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockGl),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    backend = new WebGL2Backend();
  });

  describe('initialization', () => {
    it('should have correct name', () => {
      expect(backend.name).toBe('webgl2');
    });

    it('should report WebGL2 capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(false);
      expect(backend.capabilities.supportsFloat16).toBe(true);
    });

    it('should initialize with canvas', async () => {
      await backend.init(mockCanvas);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
    });
  });

  describe('texture management', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should create texture with correct dimensions', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      expect(handle.width).toBe(100);
      expect(handle.height).toBe(100);
      expect(mockGl.createTexture).toHaveBeenCalled();
      expect(mockGl.texImage2D).toHaveBeenCalled();
    });
  });

  describe('rendering', () => {
    beforeEach(async () => {
      await backend.init(mockCanvas);
    });

    it('should render texture to screen', () => {
      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      backend.beginFrame();
      backend.renderToScreen(handle);
      backend.endFrame();

      expect(mockGl.drawArrays).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/webgl2-backend.test.ts`
Expected: FAIL - Cannot find module './webgl2-backend'

**Step 3: Implement WebGL2Backend**

Create `src/features/gpu/backend/webgl2-backend.ts`:
```typescript
/**
 * WebGL2 Render Backend
 *
 * GPU-accelerated rendering using WebGL2.
 */

import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
  RenderPassDescriptor,
} from './types';

interface WebGL2Texture {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
  format: TextureFormat;
}

// Simple fullscreen quad vertex shader
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Simple texture blit fragment shader
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;

void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;

/**
 * WebGL2 rendering backend
 */
export class WebGL2Backend implements RenderBackend {
  readonly name = 'webgl2' as const;

  readonly capabilities: BackendCapabilities = {
    maxTextureSize: 8192, // Will be updated from GL
    supportsFloat16: true,
    supportsComputeShaders: false, // WebGL2 doesn't have compute
    supportsExternalTextures: false,
    maxColorAttachments: 8,
  };

  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private textures: Map<string, WebGL2Texture> = new Map();
  private nextTextureId = 0;

  // Shader program for blitting
  private blitProgram: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private positionLocation = 0;
  private textureLocation: WebGLUniformLocation | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.gl = gl;

    // Update capabilities from actual GL limits
    (this.capabilities as { maxTextureSize: number }).maxTextureSize =
      gl.getParameter(gl.MAX_TEXTURE_SIZE);

    // Create blit shader program
    this.createBlitProgram();

    // Create fullscreen quad
    this.createQuadBuffer();
  }

  private createBlitProgram(): void {
    const gl = this.gl!;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, VERTEX_SHADER);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error(`Vertex shader error: ${gl.getShaderInfoLog(vertexShader)}`);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, FRAGMENT_SHADER);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error(`Fragment shader error: ${gl.getShaderInfoLog(fragmentShader)}`);
    }

    this.blitProgram = gl.createProgram()!;
    gl.attachShader(this.blitProgram, vertexShader);
    gl.attachShader(this.blitProgram, fragmentShader);
    gl.linkProgram(this.blitProgram);

    if (!gl.getProgramParameter(this.blitProgram, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(this.blitProgram)}`);
    }

    this.positionLocation = gl.getAttribLocation(this.blitProgram, 'a_position');
    this.textureLocation = gl.getUniformLocation(this.blitProgram, 'u_texture');
  }

  private createQuadBuffer(): void {
    const gl = this.gl!;

    // Fullscreen quad vertices (triangle strip)
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);

    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  destroy(): void {
    const gl = this.gl;
    if (!gl) return;

    // Delete all textures
    for (const tex of this.textures.values()) {
      gl.deleteTexture(tex.texture);
      if (tex.framebuffer) {
        gl.deleteFramebuffer(tex.framebuffer);
      }
    }
    this.textures.clear();

    // Delete shader program and buffer
    if (this.blitProgram) {
      gl.deleteProgram(this.blitProgram);
    }
    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
    }

    this.gl = null;
    this.canvas = null;
  }

  createTexture(width: number, height: number, format: TextureFormat): TextureHandle {
    const gl = this.gl!;
    const id = `webgl2_tex_${this.nextTextureId++}`;

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Allocate texture storage
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );

    this.textures.set(id, {
      texture,
      framebuffer: null,
      width,
      height,
      format,
    });

    return { id, width, height, format };
  }

  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void {
    const gl = this.gl!;
    const tex = this.textures.get(handle.id);
    if (!tex) {
      throw new Error(`Texture not found: ${handle.id}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      tex.width,
      tex.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
  }

  importVideoFrame(frame: VideoFrame): TextureHandle {
    const gl = this.gl!;
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const handle = this.createTexture(width, height, 'rgba8unorm');

    const tex = this.textures.get(handle.id)!;
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    return handle;
  }

  importImageBitmap(bitmap: ImageBitmap): TextureHandle {
    const gl = this.gl!;
    const handle = this.createTexture(bitmap.width, bitmap.height, 'rgba8unorm');

    const tex = this.textures.get(handle.id)!;
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

    return handle;
  }

  beginFrame(): void {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas!.width, this.canvas!.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  endFrame(): void {
    // WebGL presents automatically
  }

  renderToScreen(texture: TextureHandle): void {
    const gl = this.gl!;
    const tex = this.textures.get(texture.id);
    if (!tex) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas!.width, this.canvas!.height);

    gl.useProgram(this.blitProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    gl.uniform1i(this.textureLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  renderToTexture(pass: RenderPassDescriptor): void {
    const gl = this.gl!;
    if (!pass.output || pass.inputs.length === 0) return;

    const output = this.textures.get(pass.output.id);
    const input = this.textures.get(pass.inputs[0].id);
    if (!output || !input) return;

    // Create framebuffer for output if needed
    if (!output.framebuffer) {
      output.framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        output.texture,
        0
      );
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.viewport(0, 0, output.width, output.height);

    gl.useProgram(this.blitProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform1i(this.textureLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  async readPixels(texture: TextureHandle): Promise<Uint8Array> {
    const gl = this.gl!;
    const tex = this.textures.get(texture.id);
    if (!tex) {
      throw new Error(`Texture not found: ${texture.id}`);
    }

    // Create framebuffer if needed
    if (!tex.framebuffer) {
      tex.framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, tex.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex.texture,
        0
      );
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, tex.framebuffer);
    }

    const pixels = new Uint8Array(tex.width * tex.height * 4);
    gl.readPixels(0, 0, tex.width, tex.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    return pixels;
  }

  /**
   * Release a texture
   */
  releaseTexture(handle: TextureHandle): void {
    const gl = this.gl;
    if (!gl) return;

    const tex = this.textures.get(handle.id);
    if (tex) {
      gl.deleteTexture(tex.texture);
      if (tex.framebuffer) {
        gl.deleteFramebuffer(tex.framebuffer);
      }
      this.textures.delete(handle.id);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/backend/webgl2-backend.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/backend/webgl2-backend.ts src/features/gpu/backend/webgl2-backend.test.ts
git commit -m "feat(gpu): implement WebGL2 render backend"
```

---

## Task 6: Implement WebGPU Backend

**Files:**
- Create: `src/features/gpu/backend/webgpu-backend.ts`
- Create: `src/features/gpu/backend/webgpu-backend.test.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/backend/webgpu-backend.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebGPUBackend } from './webgpu-backend';

describe('WebGPUBackend', () => {
  let backend: WebGPUBackend;

  beforeEach(() => {
    backend = new WebGPUBackend();
  });

  describe('initialization', () => {
    it('should have correct name', () => {
      expect(backend.name).toBe('webgpu');
    });

    it('should report full capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(true);
      expect(backend.capabilities.supportsExternalTextures).toBe(true);
      expect(backend.capabilities.supportsFloat16).toBe(true);
    });
  });

  describe('texture management', () => {
    it('should create texture handle with correct properties', async () => {
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({
          configure: vi.fn(),
          getCurrentTexture: vi.fn().mockReturnValue({
            createView: vi.fn().mockReturnValue({}),
          }),
        }),
        width: 1920,
        height: 1080,
      } as unknown as HTMLCanvasElement;

      await backend.init(mockCanvas);

      const handle = backend.createTexture(100, 100, 'rgba8unorm');

      expect(handle.width).toBe(100);
      expect(handle.height).toBe(100);
      expect(handle.format).toBe('rgba8unorm');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/webgpu-backend.test.ts`
Expected: FAIL - Cannot find module './webgpu-backend'

**Step 3: Implement WebGPUBackend**

Create `src/features/gpu/backend/webgpu-backend.ts`:
```typescript
/**
 * WebGPU Render Backend
 *
 * Full GPU-accelerated rendering using WebGPU API.
 */

import type {
  RenderBackend,
  BackendCapabilities,
  TextureHandle,
  TextureFormat,
  RenderPassDescriptor,
} from './types';

interface WebGPUTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
  format: TextureFormat;
}

// Simple fullscreen quad vertex shader (WGSL)
const VERTEX_SHADER = `
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0)
  );
  return vec4f(pos[vertexIndex], 0.0, 1.0);
}
`;

// Simple texture blit fragment shader (WGSL)
const FRAGMENT_SHADER = `
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let texCoord = pos.xy / vec2f(textureDimensions(tex));
  return textureSample(tex, texSampler, texCoord);
}
`;

/**
 * Map our texture formats to WebGPU formats
 */
function toGPUFormat(format: TextureFormat): GPUTextureFormat {
  switch (format) {
    case 'rgba8unorm': return 'rgba8unorm';
    case 'rgba16float': return 'rgba16float';
    case 'rgba32float': return 'rgba32float';
    case 'bgra8unorm': return 'bgra8unorm';
    default: return 'rgba8unorm';
  }
}

/**
 * WebGPU rendering backend
 */
export class WebGPUBackend implements RenderBackend {
  readonly name = 'webgpu' as const;

  readonly capabilities: BackendCapabilities = {
    maxTextureSize: 8192,
    supportsFloat16: true,
    supportsComputeShaders: true,
    supportsExternalTextures: true,
    maxColorAttachments: 8,
  };

  private canvas: HTMLCanvasElement | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private textures: Map<string, WebGPUTexture> = new Map();
  private nextTextureId = 0;

  // Rendering resources
  private blitPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      throw new Error('No WebGPU adapter found');
    }

    this.device = await adapter.requestDevice();

    // Update capabilities from device limits
    const limits = this.device.limits;
    (this.capabilities as { maxTextureSize: number }).maxTextureSize =
      limits.maxTextureDimension2D;

    this.context = canvas.getContext('webgpu') as GPUCanvasContext;

    this.context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });

    this.createRenderResources();
  }

  private createRenderResources(): void {
    const device = this.device!;

    // Create sampler
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Create bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });

    // Create shader modules
    const vertexModule = device.createShaderModule({
      code: VERTEX_SHADER,
    });

    const fragmentModule = device.createShaderModule({
      code: FRAGMENT_SHADER,
    });

    // Create pipeline
    this.blitPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: {
        module: vertexModule,
        entryPoint: 'main',
      },
      fragment: {
        module: fragmentModule,
        entryPoint: 'main',
        targets: [{
          format: navigator.gpu.getPreferredCanvasFormat(),
        }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });
  }

  destroy(): void {
    // Destroy all textures
    for (const tex of this.textures.values()) {
      tex.texture.destroy();
    }
    this.textures.clear();

    this.device?.destroy();
    this.device = null;
    this.context = null;
    this.canvas = null;
  }

  createTexture(width: number, height: number, format: TextureFormat): TextureHandle {
    const device = this.device!;
    const id = `webgpu_tex_${this.nextTextureId++}`;

    const texture = device.createTexture({
      size: { width, height },
      format: toGPUFormat(format),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const view = texture.createView();

    this.textures.set(id, { texture, view, width, height, format });

    return { id, width, height, format };
  }

  uploadPixels(handle: TextureHandle, data: Uint8Array | Uint8ClampedArray): void {
    const device = this.device!;
    const tex = this.textures.get(handle.id);
    if (!tex) {
      throw new Error(`Texture not found: ${handle.id}`);
    }

    device.queue.writeTexture(
      { texture: tex.texture },
      data,
      { bytesPerRow: tex.width * 4 },
      { width: tex.width, height: tex.height }
    );
  }

  importVideoFrame(frame: VideoFrame): TextureHandle {
    const device = this.device!;
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    const handle = this.createTexture(width, height, 'rgba8unorm');

    const tex = this.textures.get(handle.id)!;

    device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture: tex.texture },
      { width, height }
    );

    return handle;
  }

  importImageBitmap(bitmap: ImageBitmap): TextureHandle {
    const device = this.device!;
    const handle = this.createTexture(bitmap.width, bitmap.height, 'rgba8unorm');

    const tex = this.textures.get(handle.id)!;

    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: tex.texture },
      { width: bitmap.width, height: bitmap.height }
    );

    return handle;
  }

  beginFrame(): void {
    // Frame setup is handled per-render call in WebGPU
  }

  endFrame(): void {
    // WebGPU presents automatically when the command buffer is submitted
  }

  renderToScreen(texture: TextureHandle): void {
    const device = this.device!;
    const context = this.context!;
    const tex = this.textures.get(texture.id);
    if (!tex) return;

    const commandEncoder = device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: tex.view },
      ],
    });

    renderPass.setPipeline(this.blitPipeline!);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(4);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  renderToTexture(pass: RenderPassDescriptor): void {
    const device = this.device!;
    if (!pass.output || pass.inputs.length === 0) return;

    const output = this.textures.get(pass.output.id);
    const input = this.textures.get(pass.inputs[0].id);
    if (!output || !input) return;

    const commandEncoder = device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: output.view,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: input.view },
      ],
    });

    renderPass.setPipeline(this.blitPipeline!);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(4);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
  }

  async readPixels(texture: TextureHandle): Promise<Uint8Array> {
    const device = this.device!;
    const tex = this.textures.get(texture.id);
    if (!tex) {
      throw new Error(`Texture not found: ${texture.id}`);
    }

    const bytesPerRow = Math.ceil(tex.width * 4 / 256) * 256; // Align to 256
    const bufferSize = bytesPerRow * tex.height;

    const readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture: tex.texture },
      { buffer: readBuffer, bytesPerRow },
      { width: tex.width, height: tex.height }
    );

    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readBuffer.getMappedRange());

    // Copy to unaligned buffer
    const result = new Uint8Array(tex.width * tex.height * 4);
    for (let y = 0; y < tex.height; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * tex.width * 4;
      result.set(data.subarray(srcOffset, srcOffset + tex.width * 4), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    return result;
  }

  /**
   * Release a texture
   */
  releaseTexture(handle: TextureHandle): void {
    const tex = this.textures.get(handle.id);
    if (tex) {
      tex.texture.destroy();
      this.textures.delete(handle.id);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/backend/webgpu-backend.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/gpu/backend/webgpu-backend.ts src/features/gpu/backend/webgpu-backend.test.ts
git commit -m "feat(gpu): implement WebGPU render backend"
```

---

## Task 7: Create Backend Factory

**Files:**
- Create: `src/features/gpu/backend/create-backend.ts`
- Create: `src/features/gpu/backend/create-backend.test.ts`
- Create: `src/features/gpu/backend/index.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/backend/create-backend.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackend } from './create-backend';

describe('createBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create WebGPU backend when available', async () => {
    const mockCanvas = {
      getContext: vi.fn().mockReturnValue({
        configure: vi.fn(),
        getCurrentTexture: vi.fn().mockReturnValue({
          createView: vi.fn(),
        }),
      }),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    const backend = await createBackend(mockCanvas);
    expect(backend.name).toBe('webgpu');
  });

  it('should fall back to WebGL2 when WebGPU unavailable', async () => {
    const originalGpu = navigator.gpu;
    // @ts-expect-error - testing undefined case
    navigator.gpu = undefined;

    const mockGl = {
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texParameteri: vi.fn(),
      createShader: vi.fn().mockReturnValue({}),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn().mockReturnValue(true),
      createProgram: vi.fn().mockReturnValue({}),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn().mockReturnValue(true),
      getUniformLocation: vi.fn(),
      getAttribLocation: vi.fn().mockReturnValue(0),
      createBuffer: vi.fn().mockReturnValue({}),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getParameter: vi.fn().mockReturnValue(8192),
      TEXTURE_2D: 0,
      TEXTURE_MIN_FILTER: 0,
      TEXTURE_MAG_FILTER: 0,
      TEXTURE_WRAP_S: 0,
      TEXTURE_WRAP_T: 0,
      LINEAR: 0,
      CLAMP_TO_EDGE: 0,
      RGBA: 0,
      UNSIGNED_BYTE: 0,
      VERTEX_SHADER: 0,
      FRAGMENT_SHADER: 0,
      COMPILE_STATUS: 0,
      LINK_STATUS: 0,
      ARRAY_BUFFER: 0,
      STATIC_DRAW: 0,
      MAX_TEXTURE_SIZE: 0,
    };

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockGl),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    const backend = await createBackend(mockCanvas);
    expect(backend.name).toBe('webgl2');

    Object.defineProperty(navigator, 'gpu', { value: originalGpu, writable: true });
  });

  it('should respect preferred backend option', async () => {
    const mockGl = {
      createTexture: vi.fn().mockReturnValue({}),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texParameteri: vi.fn(),
      createShader: vi.fn().mockReturnValue({}),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn().mockReturnValue(true),
      createProgram: vi.fn().mockReturnValue({}),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn().mockReturnValue(true),
      getUniformLocation: vi.fn(),
      getAttribLocation: vi.fn().mockReturnValue(0),
      createBuffer: vi.fn().mockReturnValue({}),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getParameter: vi.fn().mockReturnValue(8192),
      TEXTURE_2D: 0,
      TEXTURE_MIN_FILTER: 0,
      TEXTURE_MAG_FILTER: 0,
      TEXTURE_WRAP_S: 0,
      TEXTURE_WRAP_T: 0,
      LINEAR: 0,
      CLAMP_TO_EDGE: 0,
      RGBA: 0,
      UNSIGNED_BYTE: 0,
      VERTEX_SHADER: 0,
      FRAGMENT_SHADER: 0,
      COMPILE_STATUS: 0,
      LINK_STATUS: 0,
      ARRAY_BUFFER: 0,
      STATIC_DRAW: 0,
      MAX_TEXTURE_SIZE: 0,
    };

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockGl),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    const backend = await createBackend(mockCanvas, { preferredBackend: 'webgl2' });
    expect(backend.name).toBe('webgl2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/backend/create-backend.test.ts`
Expected: FAIL - Cannot find module './create-backend'

**Step 3: Implement createBackend factory**

Create `src/features/gpu/backend/create-backend.ts`:
```typescript
/**
 * Backend Factory
 *
 * Creates the best available render backend for the current environment.
 */

import type { RenderBackend, BackendOptions, BackendName } from './types';
import { detectBestBackend, detectWebGPUSupport, detectWebGL2Support } from './capabilities';
import { WebGPUBackend } from './webgpu-backend';
import { WebGL2Backend } from './webgl2-backend';
import { CanvasBackend } from './canvas-backend';

/**
 * Create a render backend instance
 */
function createBackendInstance(name: BackendName): RenderBackend {
  switch (name) {
    case 'webgpu':
      return new WebGPUBackend();
    case 'webgl2':
      return new WebGL2Backend();
    case 'canvas':
      return new CanvasBackend();
    default:
      throw new Error(`Unknown backend: ${name}`);
  }
}

/**
 * Create and initialize the best available render backend
 *
 * @param canvas - The canvas element to render to
 * @param options - Backend configuration options
 * @returns Initialized render backend
 */
export async function createBackend(
  canvas: HTMLCanvasElement,
  options: BackendOptions = {}
): Promise<RenderBackend> {
  const { preferredBackend, debug } = options;

  let backendName: BackendName;

  if (preferredBackend) {
    // Check if preferred backend is available
    const isAvailable = await isBackendAvailable(preferredBackend, canvas);

    if (isAvailable) {
      backendName = preferredBackend;
      if (debug) {
        console.log(`[GPU] Using preferred backend: ${backendName}`);
      }
    } else {
      // Fall back to auto-detection
      backendName = await detectBestBackend(canvas);
      if (debug) {
        console.log(`[GPU] Preferred backend ${preferredBackend} not available, falling back to: ${backendName}`);
      }
    }
  } else {
    // Auto-detect best backend
    backendName = await detectBestBackend(canvas);
    if (debug) {
      console.log(`[GPU] Auto-detected backend: ${backendName}`);
    }
  }

  const backend = createBackendInstance(backendName);
  await backend.init(canvas);

  if (debug) {
    console.log(`[GPU] Initialized ${backendName} backend with capabilities:`, backend.capabilities);
  }

  return backend;
}

/**
 * Check if a specific backend is available
 */
async function isBackendAvailable(name: BackendName, canvas?: HTMLCanvasElement): Promise<boolean> {
  switch (name) {
    case 'webgpu':
      return detectWebGPUSupport();
    case 'webgl2':
      return detectWebGL2Support(canvas);
    case 'canvas':
      return true; // Always available in browsers
    default:
      return false;
  }
}

/**
 * Get the names of all available backends
 */
export async function getAvailableBackendNames(canvas?: HTMLCanvasElement): Promise<BackendName[]> {
  const available: BackendName[] = [];

  if (await detectWebGPUSupport()) {
    available.push('webgpu');
  }

  if (detectWebGL2Support(canvas)) {
    available.push('webgl2');
  }

  available.push('canvas'); // Always available

  return available;
}
```

**Step 4: Create index file**

Create `src/features/gpu/backend/index.ts`:
```typescript
/**
 * GPU Render Backend
 *
 * Provides an abstraction layer for GPU rendering with automatic
 * fallback from WebGPU → WebGL2 → Canvas.
 */

// Types
export type {
  RenderBackend,
  BackendCapabilities,
  BackendName,
  BackendOptions,
  TextureHandle,
  TextureFormat,
  RenderPassDescriptor,
} from './types';

// Capability detection
export {
  detectWebGPUSupport,
  detectWebGL2Support,
  detectCanvasSupport,
  detectBestBackend,
  getAvailableBackends,
} from './capabilities';

// Backend implementations
export { WebGPUBackend } from './webgpu-backend';
export { WebGL2Backend } from './webgl2-backend';
export { CanvasBackend } from './canvas-backend';

// Factory
export { createBackend, getAvailableBackendNames } from './create-backend';
```

**Step 5: Run all backend tests**

Run: `npm run test:run -- src/features/gpu/backend/`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/features/gpu/backend/create-backend.ts src/features/gpu/backend/create-backend.test.ts src/features/gpu/backend/index.ts
git commit -m "feat(gpu): add backend factory and module exports"
```

---

## Task 8: Create useRenderBackend React Hook

**Files:**
- Create: `src/features/gpu/hooks/use-render-backend.ts`
- Create: `src/features/gpu/hooks/use-render-backend.test.tsx`
- Create: `src/features/gpu/hooks/index.ts`
- Create: `src/features/gpu/index.ts`

**Step 1: Write the failing test**

Create `src/features/gpu/hooks/use-render-backend.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRenderBackend } from './use-render-backend';

describe('useRenderBackend', () => {
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockCanvas = {
      getContext: vi.fn().mockReturnValue({
        configure: vi.fn(),
        getCurrentTexture: vi.fn().mockReturnValue({
          createView: vi.fn(),
        }),
      }),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;
  });

  it('should return null initially while loading', () => {
    const canvasRef = { current: mockCanvas };
    const { result } = renderHook(() => useRenderBackend(canvasRef));

    expect(result.current.backend).toBe(null);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it('should load backend when canvas is available', async () => {
    const canvasRef = { current: mockCanvas };
    const { result } = renderHook(() => useRenderBackend(canvasRef));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.backend).not.toBe(null);
    expect(result.current.backend?.name).toBe('webgpu');
  });

  it('should handle null canvas ref', () => {
    const canvasRef = { current: null };
    const { result } = renderHook(() => useRenderBackend(canvasRef));

    expect(result.current.backend).toBe(null);
    expect(result.current.isLoading).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/gpu/hooks/use-render-backend.test.tsx`
Expected: FAIL - Cannot find module './use-render-backend'

**Step 3: Implement the hook**

Create `src/features/gpu/hooks/use-render-backend.ts`:
```typescript
/**
 * useRenderBackend Hook
 *
 * React hook for managing GPU render backend lifecycle.
 */

import { useState, useEffect, useRef } from 'react';
import type { RenderBackend, BackendOptions } from '../backend/types';
import { createBackend } from '../backend/create-backend';

interface UseRenderBackendResult {
  /** The initialized render backend, or null if not ready */
  backend: RenderBackend | null;
  /** Whether the backend is currently loading */
  isLoading: boolean;
  /** Error message if initialization failed */
  error: string | null;
  /** Re-initialize the backend */
  reinitialize: () => void;
}

/**
 * Hook to create and manage a render backend for a canvas element
 *
 * @param canvasRef - Ref to the canvas element
 * @param options - Backend configuration options
 * @returns Backend state and controls
 *
 * @example
 * ```tsx
 * function GPUCanvas() {
 *   const canvasRef = useRef<HTMLCanvasElement>(null);
 *   const { backend, isLoading, error } = useRenderBackend(canvasRef);
 *
 *   if (isLoading) return <div>Loading GPU...</div>;
 *   if (error) return <div>Error: {error}</div>;
 *
 *   return <canvas ref={canvasRef} />;
 * }
 * ```
 */
export function useRenderBackend(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: BackendOptions = {}
): UseRenderBackendResult {
  const [backend, setBackend] = useState<RenderBackend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializingRef = useRef(false);
  const mountedRef = useRef(true);

  const initialize = async () => {
    const canvas = canvasRef.current;
    if (!canvas || initializingRef.current) return;

    initializingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Destroy previous backend if exists
      if (backend) {
        backend.destroy();
      }

      const newBackend = await createBackend(canvas, options);

      if (mountedRef.current) {
        setBackend(newBackend);
        setIsLoading(false);
      } else {
        // Component unmounted during initialization
        newBackend.destroy();
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setIsLoading(false);
      }
    } finally {
      initializingRef.current = false;
    }
  };

  // Initialize when canvas becomes available
  useEffect(() => {
    mountedRef.current = true;

    if (canvasRef.current) {
      initialize();
    }

    return () => {
      mountedRef.current = false;
      if (backend) {
        backend.destroy();
      }
    };
  }, [canvasRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const reinitialize = () => {
    if (backend) {
      backend.destroy();
      setBackend(null);
    }
    initialize();
  };

  return {
    backend,
    isLoading,
    error,
    reinitialize,
  };
}
```

**Step 4: Create hooks index**

Create `src/features/gpu/hooks/index.ts`:
```typescript
export { useRenderBackend } from './use-render-backend';
```

**Step 5: Create main GPU module index**

Create `src/features/gpu/index.ts`:
```typescript
/**
 * GPU Rendering Module
 *
 * WebGPU/WebGL2/Canvas rendering abstraction layer for FreeCut.
 */

// Backend exports
export * from './backend';

// Hook exports
export * from './hooks';
```

**Step 6: Run test to verify it passes**

Run: `npm run test:run -- src/features/gpu/hooks/use-render-backend.test.tsx`
Expected: PASS

**Step 7: Run all GPU tests**

Run: `npm run test:run -- src/features/gpu/`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add src/features/gpu/hooks/ src/features/gpu/index.ts
git commit -m "feat(gpu): add useRenderBackend React hook"
```

---

## Task 9: Integration Test - Render Video Frame

**Files:**
- Create: `src/features/gpu/integration.test.ts`

**Step 1: Write integration test**

Create `src/features/gpu/integration.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackend } from './backend';
import { CanvasBackend } from './backend/canvas-backend';

describe('GPU Backend Integration', () => {
  describe('CanvasBackend full workflow', () => {
    let backend: CanvasBackend;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;

    beforeEach(async () => {
      // Create real DOM elements for integration test
      canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      ctx = canvas.getContext('2d')!;

      backend = new CanvasBackend();
      await backend.init(canvas);
    });

    it('should complete full render cycle', async () => {
      // Create a texture
      const texture = backend.createTexture(100, 100, 'rgba8unorm');
      expect(texture.width).toBe(100);
      expect(texture.height).toBe(100);

      // Upload some pixel data (red square)
      const pixels = new Uint8Array(100 * 100 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255;     // R
        pixels[i + 1] = 0;   // G
        pixels[i + 2] = 0;   // B
        pixels[i + 3] = 255; // A
      }
      backend.uploadPixels(texture, pixels);

      // Render to screen
      backend.beginFrame();
      backend.renderToScreen(texture);
      backend.endFrame();

      // Read back and verify
      const readback = await backend.readPixels(texture);
      expect(readback.length).toBe(100 * 100 * 4);
      expect(readback[0]).toBe(255); // Red channel
      expect(readback[1]).toBe(0);   // Green channel
    });

    it('should handle ImageBitmap import', async () => {
      // Create a small test image
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = 50;
      imageCanvas.height = 50;
      const imageCtx = imageCanvas.getContext('2d')!;
      imageCtx.fillStyle = 'blue';
      imageCtx.fillRect(0, 0, 50, 50);

      const bitmap = await createImageBitmap(imageCanvas);
      const texture = backend.importImageBitmap(bitmap);

      expect(texture.width).toBe(50);
      expect(texture.height).toBe(50);

      const pixels = await backend.readPixels(texture);
      expect(pixels[2]).toBe(255); // Blue channel
    });
  });

  describe('Backend factory', () => {
    it('should create backend based on capabilities', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;

      // In test environment with mocked WebGPU, this should work
      const backend = await createBackend(canvas);
      expect(['webgpu', 'webgl2', 'canvas']).toContain(backend.name);
    });
  });
});
```

**Step 2: Run integration test**

Run: `npm run test:run -- src/features/gpu/integration.test.ts`
Expected: PASS

**Step 3: Run all tests**

Run: `npm run test:run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/features/gpu/integration.test.ts
git commit -m "test(gpu): add integration tests for backend workflow"
```

---

## Task 10: Documentation and Final Cleanup

**Files:**
- Create: `src/features/gpu/README.md`

**Step 1: Create module documentation**

Create `src/features/gpu/README.md`:
```markdown
# GPU Rendering Module

GPU-accelerated rendering abstraction layer for FreeCut video editor.

## Overview

This module provides a unified interface for rendering video frames using
WebGPU, WebGL2, or Canvas 2D, with automatic fallback based on browser
capabilities.

## Usage

### Basic Usage

```tsx
import { useRenderBackend } from '@/features/gpu';

function VideoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { backend, isLoading, error } = useRenderBackend(canvasRef);

  useEffect(() => {
    if (!backend) return;

    // Create a texture from video frame
    const texture = backend.importVideoFrame(videoFrame);

    // Render to screen
    backend.beginFrame();
    backend.renderToScreen(texture);
    backend.endFrame();
  }, [backend]);

  return <canvas ref={canvasRef} width={1920} height={1080} />;
}
```

### Manual Backend Creation

```typescript
import { createBackend } from '@/features/gpu';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const backend = await createBackend(canvas, {
  preferredBackend: 'webgpu', // optional
  debug: true,                // optional
});

console.log(`Using ${backend.name} backend`);
console.log('Capabilities:', backend.capabilities);
```

### Capability Detection

```typescript
import { detectBestBackend, getAvailableBackends } from '@/features/gpu';

const available = await getAvailableBackends();
console.log('Available backends:', available);
// ['webgpu', 'webgl2', 'canvas']

const best = await detectBestBackend();
console.log('Best backend:', best);
// 'webgpu'
```

## Architecture

```
┌─────────────────────────────────────────┐
│          RenderBackend Interface        │
├─────────────────────────────────────────┤
│ createTexture()  │ importVideoFrame()   │
│ uploadPixels()   │ importImageBitmap()  │
│ beginFrame()     │ renderToScreen()     │
│ endFrame()       │ renderToTexture()    │
│ readPixels()     │ destroy()            │
└────────┬────────────────┬───────────────┘
         │                │
    ┌────┴────┐      ┌────┴────┐      ┌────────────┐
    │ WebGPU  │      │ WebGL2  │      │   Canvas   │
    │ Backend │      │ Backend │      │   Backend  │
    └─────────┘      └─────────┘      └────────────┘
```

## Backends

### WebGPU (Primary)
- Full GPU acceleration
- Compute shader support
- External video texture import (zero-copy)
- Best performance

### WebGL2 (Fallback)
- GPU acceleration
- Wide browser support
- Good performance

### Canvas 2D (Last Resort)
- CPU-based rendering
- Universal support
- Limited to basic operations

## Testing

```bash
# Run all GPU tests
npm run test:run -- src/features/gpu/

# Run with coverage
npm run test:coverage -- src/features/gpu/
```
```

**Step 2: Commit documentation**

```bash
git add src/features/gpu/README.md
git commit -m "docs(gpu): add module documentation"
```

**Step 3: Final verification**

Run: `npm run test:run && npm run lint`
Expected: All tests pass, no lint errors

**Step 4: Create summary commit**

```bash
git log --oneline -10
```

Review the commits made in this phase.

---

## Phase 1 Complete

You now have:
- ✅ Vitest testing framework configured
- ✅ `RenderBackend` interface defining the abstraction
- ✅ Capability detection for WebGPU/WebGL2/Canvas
- ✅ `CanvasBackend` implementation (fallback)
- ✅ `WebGL2Backend` implementation (fallback)
- ✅ `WebGPUBackend` implementation (primary)
- ✅ `createBackend` factory with auto-detection
- ✅ `useRenderBackend` React hook
- ✅ Integration tests
- ✅ Documentation

**Next Phase:** Shader Graph Core - Building the effect node system and graph compiler.
