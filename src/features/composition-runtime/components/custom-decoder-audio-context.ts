let sharedCustomDecoderAudioContext: AudioContext | null = null;

export function getCustomDecoderAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (sharedCustomDecoderAudioContext === null || sharedCustomDecoderAudioContext.state === 'closed') {
    sharedCustomDecoderAudioContext = new Ctor();
  }
  return sharedCustomDecoderAudioContext;
}

export function ensureBufferedAudioContextResumed(): void {
  if (sharedCustomDecoderAudioContext?.state === 'suspended') {
    void sharedCustomDecoderAudioContext.resume().catch(() => undefined);
  }
}
