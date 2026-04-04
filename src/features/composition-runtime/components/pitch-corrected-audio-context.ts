let sharedPitchCorrectedAudioContext: AudioContext | null = null;

export function getPitchCorrectedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (sharedPitchCorrectedAudioContext === null || sharedPitchCorrectedAudioContext.state === 'closed') {
    sharedPitchCorrectedAudioContext = new AudioContextCtor();
  }

  return sharedPitchCorrectedAudioContext;
}

export function ensurePitchCorrectedAudioContextResumed(): void {
  if (sharedPitchCorrectedAudioContext?.state === 'suspended') {
    void sharedPitchCorrectedAudioContext.resume().catch(() => undefined);
  }
}
