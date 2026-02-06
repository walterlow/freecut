/**
 * Transitions Module
 *
 * High-performance transition system with registry-based architecture,
 * GPU acceleration, and pre-calculated animations.
 *
 * Exports:
 * - TransitionEngine: Pure calculation functions
 * - TransitionPreview: CSS-based real-time preview component
 * - TransitionRegistry: Plugin-based transition system
 * - OptimizedEffectsBasedTransitionRenderer: Production rendering component
 */

// Auto-register built-in transitions on module load
import { registerBuiltinTransitions } from './register-builtins';
import { transitionRegistry } from './registry';
import { _setRegistryGetter } from './engine';

registerBuiltinTransitions();

// Wire up the registry getter so engine can delegate without circular imports
_setRegistryGetter(() => transitionRegistry);

// Registry
export { transitionRegistry, TransitionRegistry } from './registry';
export type { TransitionRenderer, TransitionRegistryEntry } from './registry';

// Engine - pure calculation functions
export {
  calculateEasingCurve,
  calculateTransitionStyles,
  calculateFadeOpacity,
  calculateWipeClipPath,
  calculateSlideTransform,
  calculateFlipTransform,
  calculateClockWipeMask,
  calculateIrisMask,
  getTransitionProgress,
  buildClipMap,
  findActiveTransitions,
  isFrameInTransition,
  getTransitionClipIds,
  clearEasingCache,
  getEasingCacheStats,
} from './engine';

export type {
  TransitionTimingConfig,
  TransitionCalculation,
  TransitionStyleCalculation,
  ActiveTransitionInfo,
} from './engine';

// Preview components
export {
  TransitionPreview,
  StaticTransitionPreview,
} from './preview';

export type {
  TransitionPreviewItem,
  TransitionPreviewProps,
  StaticTransitionPreviewProps,
} from './preview';

// Presets
export { usePresetsStore } from './presets-store';
export { BUILTIN_PRESETS, getBuiltinPresets } from './builtin-presets';

// WebGL renderer
export {
  TransitionWebGLRenderer,
  isWebGLAvailable,
  getSharedWebGLRenderer,
  destroySharedWebGLRenderer,
} from './webgl-renderer';

// Test utilities
export {
  runTransitionTests,
  runTestsInConsole,
} from './test';
