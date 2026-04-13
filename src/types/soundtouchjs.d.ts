/**
 * Type declarations for soundtouchjs
 * https://github.com/cutterbl/SoundTouchJS
 */

declare module 'soundtouchjs' {
  /**
   * Source interface for SimpleFilter
   */
  interface FilterSource {
    extract(target: Float32Array, numFrames: number): number;
  }

  /**
   * PitchShifter provides real-time pitch shifting and tempo change
   * using the SoundTouch algorithm. Designed for real-time playback.
   */
  export class PitchShifter {
    constructor(
      audioContext: AudioContext | OfflineAudioContext,
      audioBuffer: AudioBuffer,
      bufferSize?: number
    );
    tempo: number;
    pitch: number;
    connect(destination: AudioNode): void;
    disconnect(): void;
  }

  /**
   * SoundTouch core audio processing class.
   * Processes interleaved stereo float samples.
   */
  export class SoundTouch {
    /** Tempo change rate (1.0 = normal, 2.0 = double speed) */
    tempo: number;
    /** Pitch change rate (1.0 = normal, 2.0 = octave up) */
    pitch: number;
    /** Playback rate - affects both tempo and pitch */
    rate: number;

    /** Input samples to process (interleaved stereo) */
    putSamples(samples: Float32Array, numSamples: number): void;
    /** Receive processed samples */
    receiveSamples(output: Float32Array, numSamples: number): number;
    /** Flush remaining samples */
    flush(): void;
    /** Clear all buffers */
    clear(): void;
  }

  /**
   * SimpleFilter wraps a source and SoundTouch processor for easy extraction.
   * The source should provide interleaved stereo samples.
   */
  export class SimpleFilter {
    constructor(source: FilterSource, soundTouch: SoundTouch);
    sourcePosition: number;
    /** Extract processed samples (interleaved stereo) */
    extract(target: Float32Array, numFrames: number): number;
  }

  /**
   * Web Audio node wrapper for SoundTouch
   */
  export function getWebAudioNode(
    audioContext: AudioContext,
    filter: SimpleFilter
  ): ScriptProcessorNode;
}
