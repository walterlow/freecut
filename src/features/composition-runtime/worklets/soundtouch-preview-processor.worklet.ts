import { SimpleFilter, SoundTouch } from 'soundtouchjs';
import {
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME,
  type SoundTouchPreviewProcessorMessage,
} from '../utils/soundtouch-preview-shared';
import { QueuedStereoBufferSource } from '../utils/soundtouch-preview-source';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor
): void;

class SoundTouchPreviewProcessor extends AudioWorkletProcessor {
  private readonly source = new QueuedStereoBufferSource();
  private readonly soundTouch = new SoundTouch();
  private readonly filter = new SimpleFilter(this.source as {
    extract: (target: Float32Array, numFrames: number, sourcePosition?: number) => number;
  }, this.soundTouch);
  private scratch = new Float32Array(256);
  private playing = false;
  private tempo = 1;
  private pitch = 1;

  constructor() {
    super();
    this.applySettings();
    this.port.onmessage = (event: MessageEvent<SoundTouchPreviewProcessorMessage>) => {
      this.handleMessage(event.data);
    };
  }

  private applySettings(): void {
    this.soundTouch.tempo = Math.max(0.01, this.tempo);
    this.soundTouch.pitch = Math.max(0.01, this.pitch);
    this.soundTouch.rate = 1;
  }

  private handleMessage(message: SoundTouchPreviewProcessorMessage): void {
    switch (message.type) {
      case 'append-source': {
        const leftChannel = new Float32Array(message.leftChannel);
        const rightChannel = new Float32Array(message.rightChannel);
        this.source.append({
          startFrame: message.startFrame,
          leftChannel,
          rightChannel,
          frameCount: message.frameCount,
        });
        break;
      }
      case 'seek':
        this.filter.sourcePosition = Math.max(0, Math.floor(message.frame));
        break;
      case 'set-tempo':
        this.tempo = message.tempo;
        this.applySettings();
        break;
      case 'set-pitch':
        this.pitch = message.pitch;
        this.applySettings();
        break;
      case 'set-playing':
        this.playing = message.playing;
        break;
      case 'reset':
        this.source.clear();
        this.filter.sourcePosition = 0;
        this.playing = false;
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const leftOutput = output[0];
    if (!leftOutput) {
      return true;
    }
    const rightOutput = output[1] ?? leftOutput;
    leftOutput.fill(0);
    rightOutput.fill(0);

    if (!this.playing || this.source.frameCount === 0) {
      return true;
    }

    const requiredSamples = leftOutput.length * 2;
    if (this.scratch.length < requiredSamples) {
      this.scratch = new Float32Array(requiredSamples);
    }

    const framesExtracted = this.filter.extract(this.scratch, leftOutput.length);
    const isMono = rightOutput === leftOutput;
    for (let i = 0; i < framesExtracted; i++) {
      leftOutput[i] = this.scratch[i * 2] ?? 0;
      if (!isMono) {
        rightOutput[i] = this.scratch[i * 2 + 1] ?? 0;
      }
    }

    return true;
  }
}

registerProcessor(SOUND_TOUCH_PREVIEW_PROCESSOR_NAME, SoundTouchPreviewProcessor);
