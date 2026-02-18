import { z } from 'zod';

/**
 * Validation schema for project creation/update form
 */
export const projectFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must be less than 100 characters')
    .refine((name) => name.trim().length > 0, {
      message: 'Project name cannot be only whitespace',
    }),

  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .or(z.literal('')),

  width: z
    .number()
    .int('Width must be an integer')
    .min(320, 'Width must be at least 320px')
    .max(7680, 'Width must be at most 7680px (8K)'),

  height: z
    .number()
    .int('Height must be an integer')
    .min(240, 'Height must be at least 240px')
    .max(4320, 'Height must be at most 4320px (8K)'),

  fps: z
    .number()
    .int('FPS must be an integer')
    .min(1, 'FPS must be at least 1')
    .max(240, 'FPS must be at most 240')
    .refine((fps) => [24, 25, 30, 50, 60, 120, 240].includes(fps), {
      message: 'FPS should be a common frame rate (24, 25, 30, 50, 60, 120, 240)',
    }),

  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color (e.g., #000000)')
    .optional(),
});

/**
 * Type inferred from the schema
 */
export type ProjectFormData = z.infer<typeof projectFormSchema>;

/**
 * Project template interface for preset configurations
 */
export interface ProjectTemplate {
  id: string;
  platform: string;
  name: string;
  namePrefix: string;
  width: number;
  height: number;
  fps: number;
}

/**
 * Project templates for common platforms
 * 6 preset configurations with collision-free naming
 */
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'youtube-1080p',
    platform: 'YouTube',
    name: 'YouTube 1080p',
    namePrefix: 'YouTube',
    width: 1920,
    height: 1080,
    fps: 30,
  },
  {
    id: 'vertical-9-16',
    platform: 'Vertical',
    name: 'Shorts / TikTok / Reels',
    namePrefix: 'Vertical',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'instagram-square',
    platform: 'Instagram',
    name: 'Instagram Square',
    namePrefix: 'Instagram Square',
    width: 1080,
    height: 1080,
    fps: 30,
  },
  {
    id: 'instagram-portrait',
    platform: 'Instagram',
    name: 'Instagram Portrait',
    namePrefix: 'Instagram Portrait',
    width: 1080,
    height: 1350,
    fps: 30,
  },
  {
    id: 'twitter-x',
    platform: 'Twitter/X',
    name: 'Twitter/X',
    namePrefix: 'Twitter/X',
    width: 1200,
    height: 675,
    fps: 30,
  },
  {
    id: 'linkedin',
    platform: 'LinkedIn',
    name: 'LinkedIn',
    namePrefix: 'LinkedIn',
    width: 1200,
    height: 627,
    fps: 30,
  },
] as const;

/**
 * Common resolution presets
 * Updated for 2025 social media standards
 */
export const RESOLUTION_PRESETS = [
  // Landscape (16:9)
  { label: '1280×720 (HD)', value: '1280x720', width: 1280, height: 720 },
  { label: '1920×1080 (Full HD)', value: '1920x1080', width: 1920, height: 1080 },
  { label: '2560×1440 (2K)', value: '2560x1440', width: 2560, height: 1440 },
  { label: '3840×2160 (4K)', value: '3840x2160', width: 3840, height: 2160 },
  // Vertical (9:16) - TikTok, Reels, Shorts, Stories
  { label: '1080×1920 (TikTok / Reels / Shorts)', value: '1080x1920', width: 1080, height: 1920 },
  { label: '720×1280 (Vertical 720p)', value: '720x1280', width: 720, height: 1280 },
  // Square (1:1) - Instagram, Facebook, LinkedIn feeds
  { label: '1080×1080 (Square)', value: '1080x1080', width: 1080, height: 1080 },
  // Portrait (4:5) - Instagram feed optimal
  { label: '1080×1350 (Instagram Portrait)', value: '1080x1350', width: 1080, height: 1350 },
  // Ultrawide (21:9)
  { label: '2560×1080 (Ultrawide)', value: '2560x1080', width: 2560, height: 1080 },
] as const;

/**
 * Common FPS presets
 */
export const FPS_PRESETS = [
  { label: '24 fps (Film)', value: 24 },
  { label: '25 fps (PAL)', value: 25 },
  { label: '30 fps (Standard)', value: 30 },
  { label: '50 fps (PAL High)', value: 50 },
  { label: '60 fps (Smooth)', value: 60 },
  { label: '120 fps (High Speed)', value: 120 },
  { label: '240 fps (Ultra High Speed)', value: 240 },
] as const;

/**
 * Default form values
 */
export const DEFAULT_PROJECT_VALUES: ProjectFormData = {
  name: '',
  description: '',
  width: 1920,
  height: 1080,
  fps: 30,
};

/**
 * Get resolution aspect ratio
 */
export function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);

  const ratioWidth = width / divisor;
  const ratioHeight = height / divisor;

  // Common aspect ratios
  if (ratioWidth === 16 && ratioHeight === 9) return '16:9';
  if (ratioWidth === 9 && ratioHeight === 16) return '9:16';
  if (ratioWidth === 4 && ratioHeight === 3) return '4:3';
  if (ratioWidth === 3 && ratioHeight === 4) return '3:4';
  if (ratioWidth === 21 && ratioHeight === 9) return '21:9';
  if (ratioWidth === 1 && ratioHeight === 1) return '1:1';
  if (ratioWidth === 2 && ratioHeight === 3) return '2:3';
  if (ratioWidth === 3 && ratioHeight === 2) return '3:2';
  if (ratioWidth === 4 && ratioHeight === 5) return '4:5';
  if (ratioWidth === 5 && ratioHeight === 4) return '5:4';

  return `${ratioWidth}:${ratioHeight}`;
}
