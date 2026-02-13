/**
 * Time components decomposed from total seconds
 */
interface TimeComponents {
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Decompose total seconds into hours, minutes, and seconds
 * @param totalSeconds - Total time in seconds
 * @returns Object with hours, minutes, and seconds
 */
function decomposeSeconds(totalSeconds: number): TimeComponents {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: Math.floor(totalSeconds % 60),
  };
}

/**
 * Validate FPS parameter
 * @param fps - Frames per second
 * @throws Error if fps is not positive
 */
function validateFps(fps: number): void {
  if (fps <= 0) {
    throw new Error(`Invalid FPS: ${fps}. FPS must be a positive number.`);
  }
}

/**
 * Format a frame number as timecode (HH:MM:SS:FF)
 * @param frame - Frame number
 * @param fps - Frames per second
 * @returns Formatted timecode string (e.g., "00:01:23:15")
 */
export function formatTimecode(frame: number, fps: number): string {
  validateFps(fps);

  const totalSeconds = frame / fps;
  const { hours, minutes, seconds } = decomposeSeconds(totalSeconds);
  const frames = Math.floor(frame % fps);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/**
 * Convert seconds to frame number
 * @param seconds - Time in seconds
 * @param fps - Frames per second
 * @returns Frame number
 */
export function secondsToFrames(seconds: number, fps: number): number {
  validateFps(fps);
  return Math.round(seconds * fps);
}

/**
 * Convert frame number to seconds
 * @param frames - Frame number
 * @param fps - Frames per second
 * @returns Time in seconds
 */
export function framesToSeconds(frames: number, fps: number): number {
  validateFps(fps);
  return frames / fps;
}

/**
 * Format seconds as a human-readable duration string (e.g., "2m 30s")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Helper function to zero-pad numbers
 * @param num - Number to pad
 * @returns Zero-padded string (e.g., 5 -> "05")
 */
function pad(num: number): string {
  return num.toString().padStart(2, '0');
}
