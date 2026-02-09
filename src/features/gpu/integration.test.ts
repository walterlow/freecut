import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackend, getAvailableBackendNames } from './backend';
import { CanvasBackend } from './backend/canvas-backend';
import { WebGL2Backend } from './backend/webgl2-backend';
import { WebGPUBackend } from './backend/webgpu-backend';
import type { RenderBackend } from './backend/types';

/**
 * Integration tests for the GPU rendering module.
 *
 * These tests verify that all backends implement the RenderBackend interface
 * correctly and can perform common operations.
 */
describe('GPU Backend Integration', () => {
  describe('CanvasBackend full workflow', () => {
    let backend: CanvasBackend;
    let mockCanvas: HTMLCanvasElement;
    let mockContext: CanvasRenderingContext2D;
    let mockOffscreenCanvas: HTMLCanvasElement;
    let mockOffscreenContext: CanvasRenderingContext2D;

    beforeEach(async () => {
      // Create mock offscreen context for texture storage
      mockOffscreenContext = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue({
          data: new Uint8ClampedArray(100 * 100 * 4).fill(128),
        }),
        putImageData: vi.fn(),
        clearRect: vi.fn(),
        canvas: { width: 100, height: 100 },
      } as unknown as CanvasRenderingContext2D;

      mockOffscreenCanvas = {
        getContext: vi.fn().mockReturnValue(mockOffscreenContext),
        width: 100,
        height: 100,
      } as unknown as HTMLCanvasElement;

      // Mock document.createElement for offscreen canvases
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'canvas') {
          return mockOffscreenCanvas;
        }
        return originalCreateElement(tag);
      });

      mockContext = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue({
          data: new Uint8ClampedArray(640 * 480 * 4),
        }),
        putImageData: vi.fn(),
        clearRect: vi.fn(),
        canvas: { width: 640, height: 480 },
      } as unknown as CanvasRenderingContext2D;

      mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockContext),
        width: 640,
        height: 480,
      } as unknown as HTMLCanvasElement;

      backend = new CanvasBackend();
      await backend.init(mockCanvas);
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
      expect(mockOffscreenContext.putImageData).toHaveBeenCalled();

      // Render to screen
      backend.beginFrame();
      expect(mockContext.clearRect).toHaveBeenCalled();

      backend.renderToScreen(texture);
      expect(mockContext.drawImage).toHaveBeenCalled();

      backend.endFrame();

      // Read back and verify (using mocked data)
      const readback = await backend.readPixels(texture);
      expect(readback.length).toBe(100 * 100 * 4);
    });

    it('should handle multiple textures', () => {
      const tex1 = backend.createTexture(50, 50, 'rgba8unorm');
      const tex2 = backend.createTexture(100, 100, 'rgba8unorm');
      const tex3 = backend.createTexture(200, 200, 'rgba8unorm');

      expect(tex1.id).not.toBe(tex2.id);
      expect(tex2.id).not.toBe(tex3.id);
    });

    it('should handle renderToTexture for multi-pass rendering', () => {
      const inputTex = backend.createTexture(100, 100, 'rgba8unorm');
      const outputTex = backend.createTexture(100, 100, 'rgba8unorm');

      // Upload some data to input
      const pixels = new Uint8Array(100 * 100 * 4).fill(128);
      backend.uploadPixels(inputTex, pixels);

      // Render to texture (copy input to output)
      backend.renderToTexture({
        shader: 'blit',
        inputs: [inputTex],
        output: outputTex,
        uniforms: {},
      });

      // Should have called drawImage on the offscreen context
      expect(mockOffscreenContext.drawImage).toHaveBeenCalled();
    });

    it('should properly release textures', async () => {
      const texture = backend.createTexture(100, 100, 'rgba8unorm');
      expect(texture.id).toBeDefined();

      // Release should not throw
      expect(() => backend.releaseTexture(texture)).not.toThrow();

      // Trying to read from released texture should throw
      await expect(backend.readPixels(texture)).rejects.toThrow(/not found/);
    });

    it('should handle destroy and cleanup', () => {
      backend.createTexture(100, 100, 'rgba8unorm');

      // Destroy should not throw
      expect(() => backend.destroy()).not.toThrow();
    });
  });

  describe('WebGL2Backend structure', () => {
    let backend: WebGL2Backend;

    beforeEach(() => {
      backend = new WebGL2Backend();
    });

    it('should have correct name', () => {
      expect(backend.name).toBe('webgl2');
    });

    it('should report correct capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(false);
      // Note: supportsFloat16 is determined at runtime based on extensions
      expect(typeof backend.capabilities.supportsFloat16).toBe('boolean');
      // Note: WebGL2 can import video frames via texImage2D
      expect(typeof backend.capabilities.supportsExternalTextures).toBe('boolean');
    });
  });

  describe('WebGPUBackend structure', () => {
    let backend: WebGPUBackend;

    beforeEach(() => {
      backend = new WebGPUBackend();
    });

    it('should have correct name', () => {
      expect(backend.name).toBe('webgpu');
    });

    it('should report full capabilities', () => {
      expect(backend.capabilities.supportsComputeShaders).toBe(true);
      expect(backend.capabilities.supportsExternalTextures).toBe(true);
      expect(backend.capabilities.supportsFloat16).toBe(true);
    });
  });

  describe('Backend factory', () => {
    it('should list available backends', async () => {
      const backends = await getAvailableBackendNames();

      // WebGPU should be available due to our mocks in setup.ts
      expect(backends).toContain('webgpu');
      expect(backends).toContain('canvas');
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
      backend.destroy();
    });

    it('should respect preferred backend option', async () => {
      // Create comprehensive mock for WebGL2
      const mockGl = {
        // Texture methods
        createTexture: vi.fn().mockReturnValue({}),
        bindTexture: vi.fn(),
        texImage2D: vi.fn(),
        texParameteri: vi.fn(),
        deleteTexture: vi.fn(),
        activeTexture: vi.fn(),
        // Shader methods
        createShader: vi.fn().mockReturnValue({}),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn().mockReturnValue(true),
        deleteShader: vi.fn(),
        getShaderInfoLog: vi.fn().mockReturnValue(''),
        // Program methods
        createProgram: vi.fn().mockReturnValue({}),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn().mockReturnValue(true),
        deleteProgram: vi.fn(),
        useProgram: vi.fn(),
        getProgramInfoLog: vi.fn().mockReturnValue(''),
        getUniformLocation: vi.fn().mockReturnValue({}),
        getAttribLocation: vi.fn().mockReturnValue(0),
        uniform1i: vi.fn(),
        // Buffer methods
        createBuffer: vi.fn().mockReturnValue({}),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        deleteBuffer: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        // Framebuffer methods
        createFramebuffer: vi.fn().mockReturnValue({}),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        deleteFramebuffer: vi.fn(),
        checkFramebufferStatus: vi.fn().mockReturnValue(0x8CD5), // FRAMEBUFFER_COMPLETE
        // Viewport and drawing
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clear: vi.fn(),
        drawArrays: vi.fn(),
        readPixels: vi.fn(),
        // Parameter and extension
        getParameter: vi.fn().mockReturnValue(8192),
        getExtension: vi.fn().mockReturnValue({}),
        // Constants
        TEXTURE_2D: 0x0DE1,
        TEXTURE0: 0x84C0,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        LINEAR: 0x2601,
        CLAMP_TO_EDGE: 0x812F,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        COMPILE_STATUS: 0x8B81,
        LINK_STATUS: 0x8B82,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88E4,
        MAX_TEXTURE_SIZE: 0x0D33,
        MAX_COLOR_ATTACHMENTS: 0x8CDF,
        FLOAT: 0x1406,
        FRAMEBUFFER: 0x8D40,
        COLOR_ATTACHMENT0: 0x8CE0,
        FRAMEBUFFER_COMPLETE: 0x8CD5,
        COLOR_BUFFER_BIT: 0x00004000,
        TRIANGLE_STRIP: 0x0005,
      };

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockGl),
        width: 1920,
        height: 1080,
      } as unknown as HTMLCanvasElement;

      const backend = await createBackend(mockCanvas, { preferredBackend: 'webgl2' });
      expect(backend.name).toBe('webgl2');
      backend.destroy();
    });
  });

  describe('RenderBackend interface compliance', () => {
    const backends: Array<{ name: string; createBackend: () => RenderBackend }> = [
      { name: 'CanvasBackend', createBackend: () => new CanvasBackend() },
      { name: 'WebGL2Backend', createBackend: () => new WebGL2Backend() },
      { name: 'WebGPUBackend', createBackend: () => new WebGPUBackend() },
    ];

    backends.forEach(({ name, createBackend }) => {
      describe(`${name} interface compliance`, () => {
        let backend: RenderBackend;

        beforeEach(() => {
          backend = createBackend();
        });

        it('should have required properties', () => {
          expect(backend).toHaveProperty('name');
          expect(backend).toHaveProperty('capabilities');
          expect(['webgpu', 'webgl2', 'canvas']).toContain(backend.name);
        });

        it('should have required capability properties', () => {
          const caps = backend.capabilities;
          expect(caps).toHaveProperty('maxTextureSize');
          expect(caps).toHaveProperty('supportsFloat16');
          expect(caps).toHaveProperty('supportsComputeShaders');
          expect(caps).toHaveProperty('supportsExternalTextures');
          expect(caps).toHaveProperty('maxColorAttachments');

          expect(typeof caps.maxTextureSize).toBe('number');
          expect(typeof caps.supportsFloat16).toBe('boolean');
          expect(typeof caps.supportsComputeShaders).toBe('boolean');
          expect(typeof caps.supportsExternalTextures).toBe('boolean');
          expect(typeof caps.maxColorAttachments).toBe('number');
        });

        it('should have required lifecycle methods', () => {
          expect(typeof backend.init).toBe('function');
          expect(typeof backend.destroy).toBe('function');
        });

        it('should have required texture methods', () => {
          expect(typeof backend.createTexture).toBe('function');
          expect(typeof backend.uploadPixels).toBe('function');
          expect(typeof backend.importVideoFrame).toBe('function');
          expect(typeof backend.importImageBitmap).toBe('function');
        });

        it('should have required rendering methods', () => {
          expect(typeof backend.beginFrame).toBe('function');
          expect(typeof backend.endFrame).toBe('function');
          expect(typeof backend.renderToScreen).toBe('function');
          expect(typeof backend.renderToTexture).toBe('function');
        });

        it('should have required readback methods', () => {
          expect(typeof backend.readPixels).toBe('function');
        });
      });
    });
  });

  describe('Texture handle format consistency', () => {
    it('should return consistent texture handle format', async () => {
      const mockContext = {
        drawImage: vi.fn(),
        getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(400) }),
        putImageData: vi.fn(),
        clearRect: vi.fn(),
        canvas: { width: 10, height: 10 },
      } as unknown as CanvasRenderingContext2D;

      const mockOffscreenCanvas = {
        getContext: vi.fn().mockReturnValue(mockContext),
        width: 10,
        height: 10,
      } as unknown as HTMLCanvasElement;

      vi.spyOn(document, 'createElement').mockReturnValue(mockOffscreenCanvas);

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockContext),
        width: 640,
        height: 480,
      } as unknown as HTMLCanvasElement;

      const backend = new CanvasBackend();
      await backend.init(mockCanvas);

      const texture = backend.createTexture(100, 100, 'rgba8unorm');

      // Verify texture handle structure
      expect(texture).toHaveProperty('id');
      expect(texture).toHaveProperty('width');
      expect(texture).toHaveProperty('height');
      expect(texture).toHaveProperty('format');

      expect(typeof texture.id).toBe('string');
      expect(texture.width).toBe(100);
      expect(texture.height).toBe(100);
      expect(texture.format).toBe('rgba8unorm');

      backend.destroy();
    });
  });

  describe('Backend capability hierarchy', () => {
    it('should have WebGPU with most capabilities', () => {
      const webgpu = new WebGPUBackend();
      expect(webgpu.capabilities.supportsComputeShaders).toBe(true);
      expect(webgpu.capabilities.supportsExternalTextures).toBe(true);
    });

    it('should have WebGL2 with medium capabilities', () => {
      const webgl2 = new WebGL2Backend();
      expect(webgl2.capabilities.supportsComputeShaders).toBe(false);
      expect(webgl2.capabilities.supportsFloat16).toBe(true);
    });

    it('should have Canvas with least capabilities', () => {
      const canvas = new CanvasBackend();
      expect(canvas.capabilities.supportsComputeShaders).toBe(false);
      expect(canvas.capabilities.supportsExternalTextures).toBe(false);
      expect(canvas.capabilities.supportsFloat16).toBe(false);
    });
  });
});
