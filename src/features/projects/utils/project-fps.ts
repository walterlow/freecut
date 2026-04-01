export interface ProjectFpsOption {
  label: string;
  value: number;
}

export const DEFAULT_PROJECT_FPS_OPTIONS: readonly ProjectFpsOption[] = [
  { label: '24 fps (Film)', value: 24 },
  { label: '25 fps (PAL)', value: 25 },
  { label: '30 fps (Standard)', value: 30 },
  { label: '50 fps (PAL High)', value: 50 },
  { label: '60 fps (Smooth)', value: 60 },
] as const;

export const LEGACY_PROJECT_FPS_OPTIONS: readonly ProjectFpsOption[] = [
  { label: '120 fps (Legacy)', value: 120 },
  { label: '240 fps (Legacy)', value: 240 },
] as const;

export const ALLOWED_PROJECT_FPS_VALUES = [
  ...DEFAULT_PROJECT_FPS_OPTIONS.map((option) => option.value),
  ...LEGACY_PROJECT_FPS_OPTIONS.map((option) => option.value),
] as const;

const AUTO_MATCH_PROJECT_FPS_VALUES = [
  ...DEFAULT_PROJECT_FPS_OPTIONS.map((option) => option.value),
] as const;

export function isAllowedProjectFps(value: number): boolean {
  return ALLOWED_PROJECT_FPS_VALUES.includes(value as (typeof ALLOWED_PROJECT_FPS_VALUES)[number]);
}

export function getProjectFpsOptions(currentFps?: number): ProjectFpsOption[] {
  const options = [...DEFAULT_PROJECT_FPS_OPTIONS];

  if (!currentFps || !isAllowedProjectFps(currentFps)) {
    return options;
  }

  if (options.some((option) => option.value === currentFps)) {
    return options;
  }

  const legacyOption = LEGACY_PROJECT_FPS_OPTIONS.find((option) => option.value === currentFps);
  return legacyOption ? [...options, legacyOption] : options;
}

export function formatFpsValue(fps: number): string {
  if (!Number.isFinite(fps)) {
    return '0';
  }

  if (Number.isInteger(fps)) {
    return `${fps}`;
  }

  return fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function resolveAutoMatchProjectFps(sourceFps: number): {
  fps: number;
  exact: boolean;
} {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) {
    return { fps: 30, exact: false };
  }

  let closest = AUTO_MATCH_PROJECT_FPS_VALUES[0];
  let smallestDelta = Math.abs(sourceFps - closest);

  for (const candidate of AUTO_MATCH_PROJECT_FPS_VALUES.slice(1)) {
    const delta = Math.abs(sourceFps - candidate);
    if (delta < smallestDelta) {
      closest = candidate;
      smallestDelta = delta;
    }
  }

  return {
    fps: closest,
    exact: Math.abs(sourceFps - closest) < 0.001,
  };
}
