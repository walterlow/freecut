/**
 * 360° Equirectangular Projection and FOV Options Types
 *
 * Implements camera projection models inspired by Insta360 Studio:
 * - UltraWide (~120°, Pannini curvilinear)
 * - Wide (~100°, mild curvilinear)
 * - Linear (~78°, rectilinear gnomonic / dewarped)
 * - Narrow (~55°, rectilinear telephoto)
 * - 45° Horizon Lock (roll stabilization up to 45°)
 * - 360° Horizon Lock (absolute 360° roll horizon leveling)
 * - Custom (Libre with interactive sliders)
 */

export type FovPreset =
  | 'ultra-wide'
  | 'wide'
  | 'linear'
  | 'narrow'
  | 'horizon-45'
  | 'horizon-360'
  | 'custom'

export type HorizonLockMode = 'off' | '45' | '360'

export type ProjectionSourceMode = 'ultrawide' | 'spherical_360'

export interface Projection360Settings {
  /** Master toggle for projection / FOV remapping */
  enabled: boolean
  /** Active FOV preset */
  preset: FovPreset
  /** Source video projection kind: 'ultrawide' (flat action cam / wide lens with dewarp) or 'spherical_360' */
  sourceMode?: ProjectionSourceMode
  /** Horizontal Field of View in degrees (30° to 150°) */
  fov: number
  /** Virtual camera focal distance / zoom multiplier (0.5 to 3.0) */
  distance: number
  /** Distortion curvature (0.0 = native / rectilinear, >0.0 = barrel dewarp / curvature correction) */
  distortion: number
  /** Pan angle / Yaw rotation around vertical axis in degrees (-180° to +180°) */
  yaw: number
  /** Tilt angle / Pitch rotation around lateral axis in degrees (-90° to +90°) */
  pitch: number
  /** Roll angle around camera viewing axis in degrees (-180° to +180°) */
  roll: number
  /** Horizon lock mode */
  horizonLock: HorizonLockMode
  /** Manual horizon calibration offset angle in degrees (-45° to +45°) */
  horizonOffset: number
}

export const FOV_PRESET_CONFIGS: Record<FovPreset, Partial<Projection360Settings>> = {
  'ultra-wide': {
    preset: 'ultra-wide',
    fov: 110,
    distance: 1.0,
    distortion: 0.0,
    horizonLock: 'off',
  },
  wide: {
    preset: 'wide',
    fov: 102,
    distance: 1.05,
    distortion: 0.0,
    horizonLock: 'off',
  },
  linear: {
    preset: 'linear',
    fov: 88.5,
    distance: 1.0,
    distortion: 1.0,
    horizonLock: 'off',
  },
  narrow: {
    preset: 'narrow',
    fov: 64.0,
    distance: 1.52,
    distortion: 1.0,
    horizonLock: 'off',
  },
  'horizon-45': {
    preset: 'horizon-45',
    fov: 88.5,
    distance: 1.0,
    distortion: 1.0,
    horizonLock: '45',
  },
  'horizon-360': {
    preset: 'horizon-360',
    fov: 64.0,
    distance: 1.52,
    distortion: 1.0,
    horizonLock: '360',
  },
  custom: {
    preset: 'custom',
  },
}

export const DEFAULT_PROJECTION_360_SETTINGS: Projection360Settings = {
  enabled: true,
  preset: 'linear',
  sourceMode: 'ultrawide',
  fov: 78,
  distance: 1.0,
  distortion: 1.0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  horizonLock: 'off',
  horizonOffset: 0,
}

/**
 * Apply a preset to an existing projection settings object, preserving camera angles (yaw/pitch/roll)
 */
export function applyFovPreset(
  current: Projection360Settings,
  preset: FovPreset,
): Projection360Settings {
  const presetConfig = FOV_PRESET_CONFIGS[preset]
  return {
    ...current,
    preset,
    ...(presetConfig.fov !== undefined ? { fov: presetConfig.fov } : {}),
    ...(presetConfig.distance !== undefined ? { distance: presetConfig.distance } : {}),
    ...(presetConfig.distortion !== undefined ? { distortion: presetConfig.distortion } : {}),
    ...(presetConfig.horizonLock !== undefined ? { horizonLock: presetConfig.horizonLock } : {}),
  }
}

/**
 * Check if the given width and height match an equirectangular 2:1 panoramic format
 */
export function isEquirectangularDimensions(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 256 || height < 128) {
    return false
  }
  const ratio = width / height
  return Math.abs(ratio - 2.0) <= 0.05
}

/**
 * Check if a filename suggests 360 media
 */
export function is360Filename(filename: string): boolean {
  if (!filename) return false
  const lower = filename.toLowerCase()
  return (
    lower.endsWith('.insv') ||
    lower.endsWith('.insp') ||
    lower.includes('360') ||
    lower.includes('pano') ||
    lower.includes('equirect')
  )
}
