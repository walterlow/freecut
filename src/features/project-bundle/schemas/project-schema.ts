/**
 * Zod Validation Schemas for Project Data
 *
 * Provides validation for project snapshots during import/export.
 * Ensures data integrity and provides helpful error messages.
 */

import { z } from 'zod';
import { SNAPSHOT_VERSION } from '../types/snapshot';

// ============================================================================
// Keyframe Schemas
// ============================================================================

const animatablePropertySchema = z.enum(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cornerRadius']);

const easingTypeSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier',
  'spring',
]);

const bezierControlPointsSchema = z.object({
  x1: z.number().min(0).max(1),
  y1: z.number(),
  x2: z.number().min(0).max(1),
  y2: z.number(),
});

const springParametersSchema = z.object({
  tension: z.number().min(0).max(500),
  friction: z.number().min(0).max(100),
  mass: z.number().min(0.1).max(10),
});

const easingConfigSchema = z.object({
  type: easingTypeSchema,
  bezier: bezierControlPointsSchema.optional(),
  spring: springParametersSchema.optional(),
});

const keyframeSchema = z.object({
  id: z.string().min(1),
  frame: z.number().int().min(0),
  value: z.number(),
  easing: easingTypeSchema,
  easingConfig: easingConfigSchema.optional(),
});

const propertyKeyframesSchema = z.object({
  property: animatablePropertySchema,
  keyframes: z.array(keyframeSchema),
});

const itemKeyframesSchema = z.object({
  itemId: z.string().min(1),
  properties: z.array(propertyKeyframesSchema),
});

// ============================================================================
// Timeline Item Schemas
// ============================================================================

const itemTypeSchema = z.enum(['video', 'audio', 'text', 'image', 'shape', 'adjustment']);

const shapeTypeSchema = z.enum([
  'rectangle',
  'circle',
  'triangle',
  'ellipse',
  'star',
  'polygon',
  'heart',
]);

const directionSchema = z.enum(['up', 'down', 'left', 'right']);

// Text-specific schemas
const fontWeightSchema = z.enum(['normal', 'medium', 'semibold', 'bold']);
const fontStyleSchema = z.enum(['normal', 'italic']);
const textAlignSchema = z.enum(['left', 'center', 'right']);
const verticalAlignSchema = z.enum(['top', 'middle', 'bottom']);

const textShadowSchema = z.object({
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number(),
  color: z.string(),
});

const textStrokeSchema = z.object({
  width: z.number(),
  color: z.string(),
});

// Mask schemas
const maskTypeSchema = z.enum(['clip', 'alpha']);

// ============================================================================
// Effect Schemas
// ============================================================================

const cssFilterTypeSchema = z.enum([
  'brightness', 'contrast', 'saturate', 'blur', 'hue-rotate', 'grayscale', 'sepia', 'invert',
]);

const glitchVariantSchema = z.enum(['rgb-split', 'scanlines', 'color-glitch']);

const halftonePatternTypeSchema = z.enum(['dots', 'lines', 'rays', 'ripples']);
const halftoneBlendModeSchema = z.enum(['multiply', 'screen', 'overlay', 'soft-light']);

const cssFilterEffectSchema = z.object({
  type: z.literal('css-filter'),
  filter: cssFilterTypeSchema,
  value: z.number(),
});

const glitchEffectSchema = z.object({
  type: z.literal('glitch'),
  variant: glitchVariantSchema,
  intensity: z.number().min(0).max(1),
  speed: z.number().min(0.5).max(2),
  seed: z.number(),
});

const halftoneEffectSchema = z.object({
  type: z.literal('canvas-effect'),
  variant: z.literal('halftone'),
  patternType: halftonePatternTypeSchema,
  dotSize: z.number().min(2).max(20),
  spacing: z.number().min(4).max(40),
  angle: z.number().min(0).max(360),
  intensity: z.number().min(0).max(1),
  softness: z.number().min(0).max(1),
  blendMode: halftoneBlendModeSchema,
  inverted: z.boolean(),
  fadeAngle: z.number().min(-1).max(360),
  fadeAmount: z.number().min(0).max(1),
  dotColor: z.string(),
});

const vignetteEffectSchema = z.object({
  type: z.literal('overlay-effect'),
  variant: z.literal('vignette'),
  intensity: z.number().min(0).max(1),
  size: z.number().min(0).max(1),
  softness: z.number().min(0).max(1),
  color: z.string(),
  shape: z.enum(['circular', 'elliptical']),
});

const visualEffectSchema = z.discriminatedUnion('type', [
  cssFilterEffectSchema,
  glitchEffectSchema,
  halftoneEffectSchema,
  vignetteEffectSchema,
]);

const itemEffectSchema = z.object({
  id: z.string().min(1),
  effect: visualEffectSchema,
  enabled: z.boolean(),
});

const transformSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  cornerRadius: z.number().min(0).optional(),
  aspectRatioLocked: z.boolean().optional(),
});

const timelineItemSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  from: z.number().int().min(0),
  durationInFrames: z.number().int().min(1),
  label: z.string(),
  mediaId: z.string().optional(),
  originId: z.string().optional(),
  type: itemTypeSchema,
  // Source fields
  src: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  offset: z.number().optional(), // deprecated
  waveformData: z.array(z.number()).optional(),
  sourceStart: z.number().optional(),
  sourceEnd: z.number().optional(),
  sourceDuration: z.number().optional(),
  sourceFps: z.number().positive().optional(),
  // Trim fields
  trimStart: z.number().optional(),
  trimEnd: z.number().optional(),
  // Text fields
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  fontWeight: fontWeightSchema.optional(),
  fontStyle: fontStyleSchema.optional(),
  underline: z.boolean().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  textAlign: textAlignSchema.optional(),
  verticalAlign: verticalAlignSchema.optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  textShadow: textShadowSchema.optional(),
  stroke: textStrokeSchema.optional(),
  // Shape fields
  shapeType: shapeTypeSchema.optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  direction: directionSchema.optional(),
  points: z.number().optional(),
  innerRadius: z.number().optional(),
  // Mask fields
  isMask: z.boolean().optional(),
  maskType: maskTypeSchema.optional(),
  maskFeather: z.number().min(0).max(100).optional(),
  maskInvert: z.boolean().optional(),
  // Speed
  speed: z.number().min(0.1).max(10).optional(),
  // Source dimensions
  sourceWidth: z.number().optional(),
  sourceHeight: z.number().optional(),
  // Transform
  transform: transformSchema.optional(),
  // Audio properties
  volume: z.number().min(0).max(2).optional(),
  audioFadeIn: z.number().min(0).optional(),
  audioFadeOut: z.number().min(0).optional(),
  // Video properties
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  // Effects
  effects: z.array(itemEffectSchema).optional(),
  // Adjustment layer
  effectOpacity: z.number().min(0).max(1).optional(),
});

// ============================================================================
// Track Schema
// ============================================================================

const trackSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  height: z.number().int().min(20).max(500),
  locked: z.boolean(),
  visible: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
  color: z.string().optional(),
  order: z.number().int().min(0),
  parentTrackId: z.string().optional(),
  isGroup: z.boolean().optional(),
  isCollapsed: z.boolean().optional(),
});

// ============================================================================
// Marker and Transition Schemas
// ============================================================================

const markerSchema = z.object({
  id: z.string().min(1),
  frame: z.number().int().min(0),
  label: z.string().optional(),
  color: z.string(),
});

const transitionSchema = z.object({
  id: z.string().min(1),
  type: z.literal('crossfade'),
  leftClipId: z.string().min(1),
  rightClipId: z.string().min(1),
  trackId: z.string().min(1),
  durationInFrames: z.number().int().min(1),
  presentation: z.string().optional(),
  timing: z.string().optional(),
  direction: z.string().optional(),
});

// ============================================================================
// Timeline Schema
// ============================================================================

const timelineSchema = z.object({
  tracks: z.array(trackSchema),
  items: z.array(timelineItemSchema),
  currentFrame: z.number().int().min(0).optional(),
  zoomLevel: z.number().min(0.1).max(10).optional(),
  scrollPosition: z.number().min(0).optional(),
  inPoint: z.number().int().min(0).optional(),
  outPoint: z.number().int().min(0).optional(),
  markers: z.array(markerSchema).optional(),
  transitions: z.array(transitionSchema).optional(),
  keyframes: z.array(itemKeyframesSchema).optional(),
});

// ============================================================================
// Project Resolution Schema
// ============================================================================

const projectResolutionSchema = z.object({
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(4320),
  fps: z.number().int().min(1).max(240),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

// ============================================================================
// Project Schema
// ============================================================================

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  duration: z.number().min(0),
  thumbnail: z.string().optional(),
  thumbnailUrl: z.string().optional(), // deprecated
  metadata: projectResolutionSchema,
  timeline: timelineSchema.optional(),
});

// ============================================================================
// Media Reference Schema
// ============================================================================

const mediaReferenceSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().min(0),
  mimeType: z.string().min(1),
  duration: z.number().min(0),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  fps: z.number().min(0),
  codec: z.string(),
  bitrate: z.number().min(0),
  contentHash: z.string().optional(),
});

// ============================================================================
// Snapshot Schema
// ============================================================================

const snapshotSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  editorVersion: z.string(),
  project: projectSchema,
  mediaReferences: z.array(mediaReferenceSchema),
  checksum: z.string().optional(),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

type ValidatedProject = z.infer<typeof projectSchema>;
type ValidatedSnapshot = z.infer<typeof snapshotSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a project object
 */
export function validateProject(data: unknown): {
  success: boolean;
  data?: ValidatedProject;
  errors?: z.ZodError;
} {
  const result = projectSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Validate a snapshot object
 */
export function validateSnapshot(data: unknown): {
  success: boolean;
  data?: ValidatedSnapshot;
  errors?: z.ZodError;
} {
  const result = snapshotSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Format Zod errors into human-readable messages
 */
export function formatValidationErrors(errors: z.ZodError): string[] {
  return errors.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path ? `${path}: ` : ''}${issue.message}`;
  });
}

/**
 * Check if snapshot version is compatible
 */
export function isVersionCompatible(version: string): boolean {
  const [major] = version.split('.');
  const [currentMajor] = SNAPSHOT_VERSION.split('.');
  return major === currentMajor;
}
