/**
 * GPU Render Backend
 *
 * Provides an abstraction layer for GPU rendering with automatic
 * fallback from WebGPU → WebGL2 → Canvas.
 */

// Factory
export { createBackend, getAvailableBackendNames } from './create-backend';
