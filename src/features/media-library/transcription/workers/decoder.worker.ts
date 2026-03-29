import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
} from 'mediabunny';
import { Chunker } from '../lib/chunker';
import { downmixToMono, resampleTo16kHz } from '../lib/resampler';
import type { MainThreadMessage, PCMChunk } from '../types';

let port: MessagePort | null = null;
let whisperQueueSize = 0;
let whisperQueueWaiter: (() => void) | null = null;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as { type: string; port?: MessagePort; file?: File };

  if (message.type === 'port' && message.port) {
    port = message.port;
    port.onmessage = (portEvent: MessageEvent<number>) => {
      whisperQueueSize = portEvent.data;
      if (whisperQueueSize < 3 && whisperQueueWaiter) {
        whisperQueueWaiter();
        whisperQueueWaiter = null;
      }
    };
    return;
  }

  if (message.type === 'init' && message.file) {
    try {
      await run(message.file);
    } catch (error) {
      postMain({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

async function run(file: File): Promise<void> {
  if (typeof AudioDecoder === 'undefined') {
    throw new Error('WebCodecs AudioDecoder is not available in this browser');
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) {
    input.dispose();
    throw new Error('No audio track found in file');
  }

  const duration = await audioTrack.computeDuration();
  const decoderConfig = await audioTrack.getDecoderConfig();
  if (!decoderConfig) {
    input.dispose();
    throw new Error('MediaBunny returned no decoder config for this file');
  }

  const support = await AudioDecoder.isConfigSupported(decoderConfig);
  if (!support.supported) {
    input.dispose();
    throw new Error(`Audio codec is not supported by this browser (${decoderConfig.codec})`);
  }

  const chunker = new Chunker((chunk: PCMChunk) => {
    if (!port) {
      return;
    }
    port.postMessage(chunk, [chunk.samples.buffer]);
  });

  const decoder = new AudioDecoder({
    output(audioData: AudioData) {
      try {
        const numChannels = audioData.numberOfChannels;
        const numFrames = audioData.numberOfFrames;
        const planeSize = audioData.allocationSize({
          format: 'f32-planar',
          planeIndex: 0,
        });
        const plane0 = new Float32Array(planeSize / 4);
        audioData.copyTo(plane0, { format: 'f32-planar', planeIndex: 0 });

        const channels: Float32Array[] = [plane0];
        for (let channelIndex = 1; channelIndex < numChannels; channelIndex++) {
          try {
            const channelSize = audioData.allocationSize({
              format: 'f32-planar',
              planeIndex: channelIndex,
            });
            const channelBuffer = new Float32Array(channelSize / 4);
            audioData.copyTo(channelBuffer, {
              format: 'f32-planar',
              planeIndex: channelIndex,
            });
            channels.push(channelBuffer);
          } catch {
            break;
          }
        }

        audioData.close();

        let mono: Float32Array;
        if (channels.length === numChannels) {
          mono = downmixToMono(channels);
        } else {
          const deinterleaved = Array.from(
            { length: numChannels },
            () => new Float32Array(numFrames)
          );
          for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
            for (let channelIndex = 0; channelIndex < numChannels; channelIndex++) {
              deinterleaved[channelIndex]![frameIndex] =
                plane0[frameIndex * numChannels + channelIndex] ?? 0;
            }
          }
          mono = downmixToMono(deinterleaved);
        }

        const resampled = resampleTo16kHz(mono, audioTrack.sampleRate);
        chunker.push(resampled);
      } catch (error) {
        postMain({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    error(error) {
      postMain({
        type: 'error',
        message: `AudioDecoder error: ${error.message}`,
      });
    },
  });

  decoder.configure(decoderConfig);

  try {
    const sink = new EncodedPacketSink(audioTrack);
    for await (const packet of sink.packets()) {
      while (decoder.decodeQueueSize > 10 || whisperQueueSize >= 3) {
        await new Promise<void>((resolve) => {
          if (decoder.decodeQueueSize > 10) {
            decoder.addEventListener('dequeue', () => resolve(), { once: true });
          } else {
            whisperQueueWaiter = resolve;
          }
        });
      }

      decoder.decode(packet.toEncodedAudioChunk());

      if (duration > 0) {
        postMain({
          type: 'progress',
          event: {
            stage: 'decoding',
            progress: Math.min(packet.timestamp / duration, 1),
          },
        });
      }
    }

    await decoder.flush();
    decoder.close();
    chunker.flush();
    postMain({ type: 'progress', event: { stage: 'decoding', progress: 1 } });
  } finally {
    input.dispose();
  }
}

function postMain(message: MainThreadMessage): void {
  (self as unknown as Worker).postMessage(message);
}
