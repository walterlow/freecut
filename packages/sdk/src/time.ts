import {
  framesToSeconds as coreFramesToSeconds,
  secondsToFrames as coreSecondsToFrames,
} from '@freecut/core';

export function secondsToFrames(seconds: number, fps: number): number {
  return coreSecondsToFrames(seconds, fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return coreFramesToSeconds(frames, fps);
}
