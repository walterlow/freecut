/**
 * Easing presets library.
 * A collection of commonly used easing curves organized by category.
 */

import type { EasingConfig, EasingType } from '@/types/keyframe';

/** Easing preset category */
export type EasingCategory = 'basic' | 'ease' | 'emphasis' | 'bounce' | 'elastic' | 'spring';

/** Single easing preset definition */
export interface EasingPreset {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Category for grouping */
  category: EasingCategory;
  /** Easing configuration */
  config: EasingConfig;
  /** SVG path for curve visualization (24x24 viewBox, from 2,20 to 22,4) */
  svgPath: string;
}

/** Category metadata */
export interface EasingCategoryInfo {
  id: EasingCategory;
  name: string;
  description: string;
}

/**
 * Category definitions with descriptions
 */
export const EASING_CATEGORIES: EasingCategoryInfo[] = [
  { id: 'basic', name: 'Basic', description: 'Simple linear and quadratic curves' },
  { id: 'ease', name: 'Ease', description: 'Smooth acceleration and deceleration' },
  { id: 'emphasis', name: 'Emphasis', description: 'Dramatic curves with overshoot' },
  { id: 'bounce', name: 'Bounce', description: 'Bouncy, playful animations' },
  { id: 'elastic', name: 'Elastic', description: 'Springy, stretchy feel' },
  { id: 'spring', name: 'Spring', description: 'Physics-based spring motion' },
];

/**
 * Complete library of easing presets
 */
export const EASING_PRESETS: EasingPreset[] = [
  // === BASIC ===
  {
    id: 'linear',
    name: 'Linear',
    category: 'basic',
    config: { type: 'linear' },
    svgPath: 'M2,20 L22,4',
  },
  {
    id: 'ease-in-quad',
    name: 'Ease In',
    category: 'basic',
    config: { type: 'ease-in' },
    svgPath: 'M2,20 Q2,4 22,4',
  },
  {
    id: 'ease-out-quad',
    name: 'Ease Out',
    category: 'basic',
    config: { type: 'ease-out' },
    svgPath: 'M2,20 Q22,20 22,4',
  },
  {
    id: 'ease-in-out-quad',
    name: 'Ease In Out',
    category: 'basic',
    config: { type: 'ease-in-out' },
    svgPath: 'M2,20 C2,12 22,12 22,4',
  },

  // === EASE (Cubic) ===
  {
    id: 'ease-in-cubic',
    name: 'Ease In Cubic',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.32, y1: 0, x2: 0.67, y2: 0 },
    },
    svgPath: 'M2,20 C8,20 16,4 22,4',
  },
  {
    id: 'ease-out-cubic',
    name: 'Ease Out Cubic',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.33, y1: 1, x2: 0.68, y2: 1 },
    },
    svgPath: 'M2,20 C8,20 8,4 22,4',
  },
  {
    id: 'ease-in-out-cubic',
    name: 'Ease In Out Cubic',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
    },
    svgPath: 'M2,20 C10,20 14,4 22,4',
  },
  {
    id: 'ease-in-quart',
    name: 'Ease In Quart',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.5, y1: 0, x2: 0.75, y2: 0 },
    },
    svgPath: 'M2,20 C12,20 18,4 22,4',
  },
  {
    id: 'ease-out-quart',
    name: 'Ease Out Quart',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.25, y1: 1, x2: 0.5, y2: 1 },
    },
    svgPath: 'M2,20 C6,20 6,4 22,4',
  },
  {
    id: 'ease-in-out-quart',
    name: 'Ease In Out Quart',
    category: 'ease',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.76, y1: 0, x2: 0.24, y2: 1 },
    },
    svgPath: 'M2,20 C12,20 12,4 22,4',
  },

  // === EMPHASIS ===
  {
    id: 'ease-out-back',
    name: 'Ease Out Back',
    category: 'emphasis',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
    },
    svgPath: 'M2,20 C6,20 10,0 22,4',
  },
  {
    id: 'ease-in-back',
    name: 'Ease In Back',
    category: 'emphasis',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 },
    },
    svgPath: 'M2,20 C12,24 18,4 22,4',
  },
  {
    id: 'ease-in-out-back',
    name: 'Ease In Out Back',
    category: 'emphasis',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.68, y1: -0.6, x2: 0.32, y2: 1.6 },
    },
    svgPath: 'M2,20 C8,24 16,0 22,4',
  },

  // === BOUNCE ===
  {
    id: 'bounce-out',
    name: 'Bounce Out',
    category: 'bounce',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.34, y1: 1.4, x2: 0.64, y2: 1 },
    },
    svgPath: 'M2,20 C6,20 8,-2 14,6 C16,8 18,4 22,4',
  },
  {
    id: 'bounce-in',
    name: 'Bounce In',
    category: 'bounce',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.4 },
    },
    svgPath: 'M2,20 C4,20 6,16 10,18 C14,20 18,4 22,4',
  },

  // === ELASTIC ===
  {
    id: 'elastic-out',
    name: 'Elastic Out',
    category: 'elastic',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.64, y1: 0.57, x2: 0.67, y2: 1.53 },
    },
    svgPath: 'M2,20 C4,12 6,0 10,6 C12,8 14,2 16,4 C18,5 20,4 22,4',
  },
  {
    id: 'elastic-in',
    name: 'Elastic In',
    category: 'elastic',
    config: {
      type: 'cubic-bezier',
      bezier: { x1: 0.33, y1: -0.53, x2: 0.36, y2: 0.43 },
    },
    svgPath: 'M2,20 C4,20 6,19 8,20 C10,22 12,16 14,18 C18,12 22,4 22,4',
  },

  // === SPRING ===
  {
    id: 'spring-gentle',
    name: 'Spring Gentle',
    category: 'spring',
    config: {
      type: 'spring',
      spring: { tension: 120, friction: 14, mass: 1 },
    },
    svgPath: 'M2,20 C4,8 8,2 12,6 C14,8 16,4 18,4 C20,4 22,4 22,4',
  },
  {
    id: 'spring-default',
    name: 'Spring',
    category: 'spring',
    config: {
      type: 'spring',
      spring: { tension: 170, friction: 26, mass: 1 },
    },
    svgPath: 'M2,20 C4,8 8,2 12,6 C16,10 18,3 22,4',
  },
  {
    id: 'spring-bouncy',
    name: 'Spring Bouncy',
    category: 'spring',
    config: {
      type: 'spring',
      spring: { tension: 300, friction: 10, mass: 1 },
    },
    svgPath: 'M2,20 C3,4 5,-2 8,8 C10,14 11,0 14,6 C16,10 18,2 20,4 C21,5 22,4 22,4',
  },
  {
    id: 'spring-stiff',
    name: 'Spring Stiff',
    category: 'spring',
    config: {
      type: 'spring',
      spring: { tension: 400, friction: 30, mass: 1 },
    },
    svgPath: 'M2,20 C3,6 6,2 10,4 C12,5 14,3 16,4 C20,4 22,4 22,4',
  },
  {
    id: 'spring-slow',
    name: 'Spring Slow',
    category: 'spring',
    config: {
      type: 'spring',
      spring: { tension: 100, friction: 20, mass: 2 },
    },
    svgPath: 'M2,20 C6,10 10,4 14,6 C18,8 20,4 22,4',
  },
];

/**
 * Get presets by category
 */
export function getPresetsByCategory(category: EasingCategory): EasingPreset[] {
  return EASING_PRESETS.filter((p) => p.category === category);
}

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): EasingPreset | undefined {
  return EASING_PRESETS.find((p) => p.id === id);
}

/**
 * Find the matching preset for a given easing config
 */
export function findMatchingPreset(config: EasingConfig): EasingPreset | undefined {
  // For basic types, match by type directly
  if (config.type !== 'cubic-bezier' && config.type !== 'spring') {
    return EASING_PRESETS.find(
      (p) => p.config.type === config.type && p.config.type !== 'cubic-bezier' && p.config.type !== 'spring'
    );
  }

  // For cubic-bezier, compare control points
  if (config.type === 'cubic-bezier' && config.bezier) {
    return EASING_PRESETS.find((p) => {
      if (p.config.type !== 'cubic-bezier' || !p.config.bezier) return false;
      const b1 = config.bezier!;
      const b2 = p.config.bezier;
      const tolerance = 0.01;
      return (
        Math.abs(b1.x1 - b2.x1) < tolerance &&
        Math.abs(b1.y1 - b2.y1) < tolerance &&
        Math.abs(b1.x2 - b2.x2) < tolerance &&
        Math.abs(b1.y2 - b2.y2) < tolerance
      );
    });
  }

  // For spring, compare parameters
  if (config.type === 'spring' && config.spring) {
    return EASING_PRESETS.find((p) => {
      if (p.config.type !== 'spring' || !p.config.spring) return false;
      const s1 = config.spring!;
      const s2 = p.config.spring;
      return s1.tension === s2.tension && s1.friction === s2.friction && s1.mass === s2.mass;
    });
  }

  return undefined;
}

/**
 * Create an EasingConfig from just an EasingType (uses defaults for advanced types)
 */
export function createEasingConfig(type: EasingType): EasingConfig {
  switch (type) {
    case 'cubic-bezier':
      return {
        type: 'cubic-bezier',
        bezier: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, // Default ease-in-out
      };
    case 'spring':
      return {
        type: 'spring',
        spring: { tension: 170, friction: 26, mass: 1 }, // Default spring
      };
    default:
      return { type };
  }
}
