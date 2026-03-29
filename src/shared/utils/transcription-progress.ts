export type TranscriptionProgressStage = 'loading' | 'decoding' | 'transcribing';

export interface TranscriptionProgressSnapshot {
  stage: TranscriptionProgressStage;
  progress: number;
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress));
}

export function getTranscriptionOverallProgress(
  snapshot: TranscriptionProgressSnapshot,
): number {
  const normalizedProgress = clampProgress(snapshot.progress);

  switch (snapshot.stage) {
    case 'loading':
      return normalizedProgress * 0.35;
    case 'decoding':
      return 0.35 + normalizedProgress * 0.35;
    case 'transcribing':
      return 0.7 + normalizedProgress * 0.3;
  }
}

export function getTranscriptionOverallPercent(
  snapshot: TranscriptionProgressSnapshot,
): number {
  return getTranscriptionOverallProgress(snapshot) * 100;
}

export function mergeTranscriptionProgress(
  previous: TranscriptionProgressSnapshot | undefined,
  next: TranscriptionProgressSnapshot,
): TranscriptionProgressSnapshot {
  const normalizedNext = {
    stage: next.stage,
    progress: clampProgress(next.progress),
  } satisfies TranscriptionProgressSnapshot;

  if (!previous) {
    return normalizedNext;
  }

  return getTranscriptionOverallProgress(normalizedNext) >= getTranscriptionOverallProgress(previous)
    ? normalizedNext
    : previous;
}

export function getTranscriptionStageLabel(stage: TranscriptionProgressStage): string {
  switch (stage) {
    case 'loading':
      return 'Loading model';
    case 'decoding':
      return 'Decoding audio';
    case 'transcribing':
      return 'Transcribing';
  }
}
