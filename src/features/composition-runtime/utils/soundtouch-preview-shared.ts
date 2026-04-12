export const SOUND_TOUCH_PREVIEW_PROCESSOR_NAME = 'freecut-soundtouch-preview';

export interface SoundTouchAppendSourceMessage {
  type: 'append-source';
  startFrame: number;
  leftChannel: ArrayBuffer;
  rightChannel: ArrayBuffer;
  frameCount: number;
  sampleRate: number;
}

export interface SoundTouchSeekMessage {
  type: 'seek';
  frame: number;
}

export interface SoundTouchSetTempoMessage {
  type: 'set-tempo';
  tempo: number;
}

export interface SoundTouchSetPitchMessage {
  type: 'set-pitch';
  pitch: number;
}

export interface SoundTouchSetPlayingMessage {
  type: 'set-playing';
  playing: boolean;
}

export interface SoundTouchResetMessage {
  type: 'reset';
}

export type SoundTouchPreviewProcessorMessage =
  | SoundTouchAppendSourceMessage
  | SoundTouchSeekMessage
  | SoundTouchSetTempoMessage
  | SoundTouchSetPitchMessage
  | SoundTouchSetPlayingMessage
  | SoundTouchResetMessage;
