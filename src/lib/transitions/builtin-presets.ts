/**
 * Built-in Transition Presets
 *
 * 40+ curated presets combining transitions with timing/duration/direction configs.
 * Each preset is a ready-to-apply configuration.
 */

import type { TransitionPreset } from '@/types/transition';

export const BUILTIN_PRESETS: TransitionPreset[] = [
  // ===== Basic =====
  {
    id: 'preset-smooth-crossfade',
    name: 'Smooth Crossfade',
    category: 'basic',
    config: { presentation: 'fade', timing: 'ease-in-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['smooth', 'fade', 'gentle'],
  },
  {
    id: 'preset-quick-cut',
    name: 'Quick Cut',
    category: 'basic',
    config: { presentation: 'none', timing: 'linear', durationInFrames: 1 },
    builtIn: true,
    tags: ['quick', 'cut', 'instant'],
  },
  {
    id: 'preset-film-dissolve',
    name: 'Film Dissolve',
    category: 'basic',
    config: { presentation: 'dissolve', timing: 'ease-out', durationInFrames: 45 },
    builtIn: true,
    tags: ['film', 'dissolve', 'cinematic'],
  },
  {
    id: 'preset-long-fade',
    name: 'Long Fade',
    category: 'basic',
    config: { presentation: 'fade', timing: 'linear', durationInFrames: 60 },
    builtIn: true,
    tags: ['long', 'fade', 'slow'],
  },
  {
    id: 'preset-additive-blend',
    name: 'Additive Blend',
    category: 'basic',
    config: { presentation: 'additive-dissolve', timing: 'ease-in-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['additive', 'blend', 'bright'],
  },
  {
    id: 'preset-fast-fade',
    name: 'Fast Fade',
    category: 'basic',
    config: { presentation: 'fade', timing: 'ease-in', durationInFrames: 10 },
    builtIn: true,
    tags: ['fast', 'fade', 'quick'],
  },

  // ===== Wipe =====
  {
    id: 'preset-wipe-left',
    name: 'Wipe Left',
    category: 'wipe',
    config: { presentation: 'wipe', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-left' },
    builtIn: true,
    tags: ['wipe', 'left', 'horizontal'],
  },
  {
    id: 'preset-wipe-right',
    name: 'Wipe Right',
    category: 'wipe',
    config: { presentation: 'wipe', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-right' },
    builtIn: true,
    tags: ['wipe', 'right', 'horizontal'],
  },
  {
    id: 'preset-wipe-down',
    name: 'Wipe Down',
    category: 'wipe',
    config: { presentation: 'wipe', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-top' },
    builtIn: true,
    tags: ['wipe', 'down', 'vertical'],
  },
  {
    id: 'preset-wipe-up',
    name: 'Wipe Up',
    category: 'wipe',
    config: { presentation: 'wipe', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-bottom' },
    builtIn: true,
    tags: ['wipe', 'up', 'vertical'],
  },
  {
    id: 'preset-barn-door-open',
    name: 'Barn Door Open',
    category: 'wipe',
    config: { presentation: 'barn-door', timing: 'ease-out', durationInFrames: 25 },
    builtIn: true,
    tags: ['barn', 'door', 'split', 'center'],
  },
  {
    id: 'preset-venetian-blinds',
    name: 'Venetian Blinds',
    category: 'wipe',
    config: { presentation: 'venetian-blinds', timing: 'linear', durationInFrames: 30 },
    builtIn: true,
    tags: ['venetian', 'blinds', 'strips'],
  },
  {
    id: 'preset-diagonal-wipe',
    name: 'Diagonal Wipe',
    category: 'wipe',
    config: { presentation: 'diagonal-wipe', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-left' },
    builtIn: true,
    tags: ['diagonal', 'wipe', 'corner'],
  },

  // ===== Slide =====
  {
    id: 'preset-slide-left',
    name: 'Slide Left',
    category: 'slide',
    config: { presentation: 'slide', timing: 'ease-in-out', durationInFrames: 25, direction: 'from-left' },
    builtIn: true,
    tags: ['slide', 'left'],
  },
  {
    id: 'preset-slide-right',
    name: 'Slide Right',
    category: 'slide',
    config: { presentation: 'slide', timing: 'ease-in-out', durationInFrames: 25, direction: 'from-right' },
    builtIn: true,
    tags: ['slide', 'right'],
  },
  {
    id: 'preset-push-left',
    name: 'Push Left',
    category: 'slide',
    config: { presentation: 'push', timing: 'ease-in-out', durationInFrames: 25, direction: 'from-left' },
    builtIn: true,
    tags: ['push', 'left'],
  },
  {
    id: 'preset-push-right',
    name: 'Push Right',
    category: 'slide',
    config: { presentation: 'push', timing: 'ease-in-out', durationInFrames: 25, direction: 'from-right' },
    builtIn: true,
    tags: ['push', 'right'],
  },
  {
    id: 'preset-cover-left',
    name: 'Cover Left',
    category: 'slide',
    config: { presentation: 'cover', timing: 'ease-out', durationInFrames: 20, direction: 'from-left' },
    builtIn: true,
    tags: ['cover', 'left', 'overlay'],
  },
  {
    id: 'preset-cover-right',
    name: 'Cover Right',
    category: 'slide',
    config: { presentation: 'cover', timing: 'ease-out', durationInFrames: 20, direction: 'from-right' },
    builtIn: true,
    tags: ['cover', 'right', 'overlay'],
  },
  {
    id: 'preset-swap-horizontal',
    name: 'Swap Horizontal',
    category: 'slide',
    config: { presentation: 'swap', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-left' },
    builtIn: true,
    tags: ['swap', 'exchange', 'horizontal'],
  },

  // ===== Flip =====
  {
    id: 'preset-flip-horizontal',
    name: 'Flip Horizontal',
    category: 'flip',
    config: { presentation: 'flip', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-left' },
    builtIn: true,
    tags: ['flip', 'horizontal', '3d'],
  },
  {
    id: 'preset-flip-vertical',
    name: 'Flip Vertical',
    category: 'flip',
    config: { presentation: 'flip', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-top' },
    builtIn: true,
    tags: ['flip', 'vertical', '3d'],
  },
  {
    id: 'preset-3d-cube-left',
    name: '3D Cube Left',
    category: 'flip',
    config: { presentation: 'cube', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-left' },
    builtIn: true,
    tags: ['cube', '3d', 'rotation', 'left'],
  },
  {
    id: 'preset-3d-cube-right',
    name: '3D Cube Right',
    category: 'flip',
    config: { presentation: 'cube', timing: 'ease-in-out', durationInFrames: 30, direction: 'from-right' },
    builtIn: true,
    tags: ['cube', '3d', 'rotation', 'right'],
  },
  {
    id: 'preset-page-turn',
    name: 'Page Turn',
    category: 'flip',
    config: { presentation: 'page-turn', timing: 'ease-in-out', durationInFrames: 35, direction: 'from-left' },
    builtIn: true,
    tags: ['page', 'turn', 'book', '3d'],
  },

  // ===== Zoom =====
  {
    id: 'preset-zoom-in',
    name: 'Zoom In',
    category: 'zoom',
    config: { presentation: 'zoom-in', timing: 'ease-in', durationInFrames: 25 },
    builtIn: true,
    tags: ['zoom', 'in', 'scale'],
  },
  {
    id: 'preset-zoom-out',
    name: 'Zoom Out',
    category: 'zoom',
    config: { presentation: 'zoom-out', timing: 'ease-out', durationInFrames: 25 },
    builtIn: true,
    tags: ['zoom', 'out', 'scale'],
  },
  {
    id: 'preset-zoom-in-slow',
    name: 'Slow Zoom In',
    category: 'zoom',
    config: { presentation: 'zoom-in', timing: 'ease-in-out', durationInFrames: 45 },
    builtIn: true,
    tags: ['zoom', 'in', 'slow', 'dramatic'],
  },

  // ===== Mask =====
  {
    id: 'preset-clock-wipe',
    name: 'Clock Wipe',
    category: 'mask',
    config: { presentation: 'clockWipe', timing: 'linear', durationInFrames: 30 },
    builtIn: true,
    tags: ['clock', 'wipe', 'radial'],
  },
  {
    id: 'preset-iris',
    name: 'Iris',
    category: 'mask',
    config: { presentation: 'iris', timing: 'ease-out', durationInFrames: 25 },
    builtIn: true,
    tags: ['iris', 'circle', 'reveal'],
  },
  {
    id: 'preset-heart-reveal',
    name: 'Heart Reveal',
    category: 'mask',
    config: { presentation: 'heart', timing: 'ease-in-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['heart', 'love', 'shape'],
  },
  {
    id: 'preset-star-reveal',
    name: 'Star Reveal',
    category: 'mask',
    config: { presentation: 'star', timing: 'ease-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['star', 'shape', 'reveal'],
  },
  {
    id: 'preset-diamond-reveal',
    name: 'Diamond Reveal',
    category: 'mask',
    config: { presentation: 'diamond', timing: 'ease-in-out', durationInFrames: 25 },
    builtIn: true,
    tags: ['diamond', 'shape', 'reveal'],
  },

  // ===== Blur =====
  {
    id: 'preset-blur-through',
    name: 'Blur Through',
    category: 'blur',
    config: { presentation: 'blur-through', timing: 'ease-in-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['blur', 'soft', 'dreamy'],
  },
  {
    id: 'preset-blur-fast',
    name: 'Quick Blur',
    category: 'blur',
    config: { presentation: 'blur-through', timing: 'ease-in', durationInFrames: 15 },
    builtIn: true,
    tags: ['blur', 'fast', 'quick'],
  },
  {
    id: 'preset-blur-slow',
    name: 'Dreamy Blur',
    category: 'blur',
    config: { presentation: 'blur-through', timing: 'ease-in-out', durationInFrames: 50 },
    builtIn: true,
    tags: ['blur', 'slow', 'dreamy', 'cinematic'],
  },

  // ===== Distortion =====
  {
    id: 'preset-glitch',
    name: 'Glitch',
    category: 'distortion',
    config: { presentation: 'glitch', timing: 'linear', durationInFrames: 15 },
    builtIn: true,
    tags: ['glitch', 'digital', 'error'],
  },
  {
    id: 'preset-glitch-long',
    name: 'Glitch Extended',
    category: 'distortion',
    config: { presentation: 'glitch', timing: 'ease-in-out', durationInFrames: 30 },
    builtIn: true,
    tags: ['glitch', 'digital', 'long'],
  },

  // ===== Cinematic Combos =====
  {
    id: 'preset-cinematic-fade',
    name: 'Cinematic Fade',
    category: 'basic',
    config: {
      presentation: 'dissolve',
      timing: 'cubic-bezier',
      durationInFrames: 45,
      bezierPoints: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 },
    },
    builtIn: true,
    tags: ['cinematic', 'film', 'dissolve', 'bezier'],
  },
  {
    id: 'preset-dramatic-wipe',
    name: 'Dramatic Wipe',
    category: 'wipe',
    config: {
      presentation: 'wipe',
      timing: 'cubic-bezier',
      durationInFrames: 40,
      direction: 'from-left',
      bezierPoints: { x1: 0.7, y1: 0.0, x2: 0.3, y2: 1.0 },
    },
    builtIn: true,
    tags: ['dramatic', 'wipe', 'slow', 'bezier'],
  },
  {
    id: 'preset-bounce-slide',
    name: 'Bounce Slide',
    category: 'slide',
    config: {
      presentation: 'slide',
      timing: 'spring',
      durationInFrames: 30,
      direction: 'from-right',
    },
    builtIn: true,
    tags: ['bounce', 'slide', 'spring', 'playful'],
  },
  {
    id: 'preset-asymmetric-fade',
    name: 'Asymmetric Fade',
    category: 'basic',
    config: {
      presentation: 'fade',
      timing: 'ease-in-out',
      durationInFrames: 30,
      alignment: 0.25,
    },
    builtIn: true,
    tags: ['asymmetric', 'fade', 'offset'],
  },
];

/**
 * Get all built-in presets.
 */
export function getBuiltinPresets(): TransitionPreset[] {
  return BUILTIN_PRESETS;
}
