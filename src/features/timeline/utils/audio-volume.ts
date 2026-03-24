export const AUDIO_VOLUME_DB_MIN = -60;
export const AUDIO_VOLUME_DB_MAX = 12;
const AUDIO_VOLUME_PADDING_PERCENT = 12;
const AUDIO_VOLUME_CENTER_DB = 0;
const AUDIO_VOLUME_FINE_ADJUST_MULTIPLIER = 0.2;

function getAudioVolumeBounds(height: number) {
  const usableTop = AUDIO_VOLUME_PADDING_PERCENT;
  const usableBottom = height - AUDIO_VOLUME_PADDING_PERCENT;
  const centerY = (usableTop + usableBottom) / 2;

  return { usableTop, usableBottom, centerY };
}

export function clampAudioVolumeDb(volume: number): number {
  return Math.max(
    AUDIO_VOLUME_DB_MIN,
    Math.min(AUDIO_VOLUME_DB_MAX, Math.round(volume * 10) / 10),
  );
}

export function getAudioVolumeLineY(volumeDb: number, height: number): number {
  const clampedVolume = clampAudioVolumeDb(volumeDb);
  const { usableTop, usableBottom, centerY } = getAudioVolumeBounds(height);

  if (clampedVolume >= AUDIO_VOLUME_CENTER_DB) {
    const positiveRatio = (AUDIO_VOLUME_DB_MAX - clampedVolume) / (AUDIO_VOLUME_DB_MAX - AUDIO_VOLUME_CENTER_DB);
    return usableTop + positiveRatio * (centerY - usableTop);
  }

  const negativeRatio = (AUDIO_VOLUME_CENTER_DB - clampedVolume) / (AUDIO_VOLUME_CENTER_DB - AUDIO_VOLUME_DB_MIN);
  return centerY + negativeRatio * (usableBottom - centerY);
}

export function getAudioVolumeDbFromOffset(pointerOffsetY: number, height: number): number {
  const { usableTop, usableBottom, centerY } = getAudioVolumeBounds(height);
  const clampedY = Math.max(usableTop, Math.min(usableBottom, pointerOffsetY));

  const volume = clampedY <= centerY
    ? AUDIO_VOLUME_DB_MAX - ((clampedY - usableTop) / Math.max(1, centerY - usableTop)) * (AUDIO_VOLUME_DB_MAX - AUDIO_VOLUME_CENTER_DB)
    : AUDIO_VOLUME_CENTER_DB - ((clampedY - centerY) / Math.max(1, usableBottom - centerY)) * (AUDIO_VOLUME_CENTER_DB - AUDIO_VOLUME_DB_MIN);

  return clampAudioVolumeDb(volume);
}

export function getAudioVolumeDbFromDragDelta(params: {
  startVolumeDb: number;
  pointerDeltaY: number;
  height: number;
}): number {
  const { usableTop, usableBottom } = getAudioVolumeBounds(params.height);
  const usableHeight = Math.max(1, usableBottom - usableTop);
  const range = AUDIO_VOLUME_DB_MAX - AUDIO_VOLUME_DB_MIN;
  const nextVolume = params.startVolumeDb - (params.pointerDeltaY / usableHeight) * range * AUDIO_VOLUME_FINE_ADJUST_MULTIPLIER;

  return clampAudioVolumeDb(nextVolume);
}

export function getAudioVisualizationScale(volumeDb: number): number {
  const linearGain = Math.pow(10, clampAudioVolumeDb(volumeDb) / 20);
  return Math.max(0.03, Math.min(4, linearGain));
}
