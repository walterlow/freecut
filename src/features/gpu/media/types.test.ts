import { describe, it, expect } from 'vitest';
import type {
  ProbeResult,
  VideoTrackInfo,
  DecodedVideoFrame,
  DecodedAudioSamples,
  FrameCacheEntry,
  CacheStats,
  PrefetchConfig,
  MediaSourceState,
  PixelFormat,
  SeekTarget,
  DecoderConfig,
} from './types';

describe('Media Types', () => {
  describe('ProbeResult', () => {
    it('should define probe result structure', () => {
      const probe: ProbeResult = {
        container: 'mp4',
        durationMs: 60000,
        video: {
          codec: 'h264',
          codecString: 'avc1.42E01E',
          width: 1920,
          height: 1080,
          frameRate: 30,
          pixelAspectRatio: 1.0,
          decoderPath: 'webcodecs',
        },
        audio: {
          codec: 'aac',
          codecString: 'mp4a.40.2',
          sampleRate: 48000,
          channels: 2,
          decoderPath: 'webcodecs',
        },
      };

      expect(probe.container).toBe('mp4');
      expect(probe.durationMs).toBe(60000);
      expect(probe.video?.width).toBe(1920);
      expect(probe.audio?.sampleRate).toBe(48000);
    });

    it('should allow optional tracks', () => {
      const audioOnly: ProbeResult = {
        container: 'mp3',
        durationMs: 180000,
        audio: {
          codec: 'mp3',
          codecString: 'mp3',
          sampleRate: 44100,
          channels: 2,
          decoderPath: 'webcodecs',
        },
      };

      expect(audioOnly.video).toBeUndefined();
      expect(audioOnly.audio?.codec).toBe('mp3');
    });
  });

  describe('VideoTrackInfo', () => {
    it('should define video track structure', () => {
      const video: VideoTrackInfo = {
        codec: 'h264',
        codecString: 'avc1.42E01E',
        width: 3840,
        height: 2160,
        frameRate: 60,
        pixelAspectRatio: 1.0,
        bitrate: 50_000_000,
        frameCount: 3600,
        decoderPath: 'webcodecs',
      };

      expect(video.codec).toBe('h264');
      expect(video.width).toBe(3840);
      expect(video.height).toBe(2160);
      expect(video.frameRate).toBe(60);
    });

    it('should indicate FFmpeg decoder for ProRes', () => {
      const prores: VideoTrackInfo = {
        codec: 'prores',
        codecString: 'apch',
        width: 1920,
        height: 1080,
        frameRate: 24,
        pixelAspectRatio: 1.0,
        decoderPath: 'ffmpeg',
      };

      expect(prores.decoderPath).toBe('ffmpeg');
    });
  });

  describe('DecodedVideoFrame', () => {
    it('should define decoded frame structure', () => {
      const frame: DecodedVideoFrame = {
        frameNumber: 0,
        timestampMs: 0,
        width: 1920,
        height: 1080,
        format: 'rgba',
        data: new Uint8Array(1920 * 1080 * 4),
        durationMs: 33.33,
        isKeyframe: true,
        source: 'webcodecs',
      };

      expect(frame.frameNumber).toBe(0);
      expect(frame.format).toBe('rgba');
      expect(frame.isKeyframe).toBe(true);
    });

    it('should support different pixel formats', () => {
      const formats: PixelFormat[] = ['rgba', 'rgb', 'yuv420', 'yuv422', 'yuv444', 'nv12'];

      formats.forEach((format) => {
        const frame: DecodedVideoFrame = {
          frameNumber: 0,
          timestampMs: 0,
          width: 1920,
          height: 1080,
          format,
          data: new Uint8Array(100),
          durationMs: 33.33,
          isKeyframe: true,
          source: 'ffmpeg',
        };

        expect(frame.format).toBe(format);
      });
    });
  });

  describe('DecodedAudioSamples', () => {
    it('should define decoded audio structure', () => {
      const samples: DecodedAudioSamples = {
        timestampMs: 0,
        sampleRate: 48000,
        channels: 2,
        data: [new Float32Array(1024), new Float32Array(1024)],
        sampleCount: 1024,
        durationMs: 21.33,
      };

      expect(samples.sampleRate).toBe(48000);
      expect(samples.channels).toBe(2);
      expect(samples.data.length).toBe(2);
    });
  });

  describe('SeekTarget', () => {
    it('should define seek target modes', () => {
      const exactSeek: SeekTarget = {
        timestampMs: 5000,
        mode: 'exact',
      };

      const keyframeSeek: SeekTarget = {
        timestampMs: 5000,
        mode: 'keyframe',
      };

      const fastSeek: SeekTarget = {
        timestampMs: 5000,
        mode: 'fast',
      };

      expect(exactSeek.mode).toBe('exact');
      expect(keyframeSeek.mode).toBe('keyframe');
      expect(fastSeek.mode).toBe('fast');
    });
  });

  describe('CacheStats', () => {
    it('should define cache statistics', () => {
      const stats: CacheStats = {
        entries: 100,
        sizeBytes: 500_000_000,
        maxSizeBytes: 1_000_000_000,
        hits: 950,
        misses: 50,
        evictions: 25,
        hitRate: 0.95,
      };

      expect(stats.entries).toBe(100);
      expect(stats.hitRate).toBe(0.95);
      expect(stats.sizeBytes).toBeLessThanOrEqual(stats.maxSizeBytes);
    });
  });

  describe('PrefetchConfig', () => {
    it('should define prefetch configuration', () => {
      const config: PrefetchConfig = {
        aheadFrames: 30,
        behindFrames: 5,
        maxConcurrent: 4,
        priority: 1,
      };

      expect(config.aheadFrames).toBe(30);
      expect(config.behindFrames).toBe(5);
      expect(config.maxConcurrent).toBe(4);
    });
  });

  describe('MediaSourceState', () => {
    it('should define valid states', () => {
      const states: MediaSourceState[] = ['idle', 'loading', 'ready', 'error', 'closed'];

      states.forEach((state) => {
        expect(['idle', 'loading', 'ready', 'error', 'closed']).toContain(state);
      });
    });
  });

  describe('DecoderConfig', () => {
    it('should define video decoder config', () => {
      const config: DecoderConfig = {
        video: {
          codec: 'avc1.42E01E',
          codedWidth: 1920,
          codedHeight: 1080,
          hardwareAcceleration: 'prefer-hardware',
        },
      };

      expect(config.video?.codec).toBe('avc1.42E01E');
      expect(config.video?.hardwareAcceleration).toBe('prefer-hardware');
    });

    it('should define audio decoder config', () => {
      const config: DecoderConfig = {
        audio: {
          codec: 'mp4a.40.2',
          sampleRate: 48000,
          numberOfChannels: 2,
        },
      };

      expect(config.audio?.codec).toBe('mp4a.40.2');
      expect(config.audio?.sampleRate).toBe(48000);
    });
  });

  describe('FrameCacheEntry', () => {
    it('should define cache entry structure', () => {
      const entry: FrameCacheEntry = {
        key: 'source-1:frame-100',
        frame: {
          frameNumber: 100,
          timestampMs: 3333.33,
          width: 1920,
          height: 1080,
          format: 'rgba',
          data: new Uint8Array(1920 * 1080 * 4),
          durationMs: 33.33,
          isKeyframe: false,
          source: 'webcodecs',
        },
        sizeBytes: 1920 * 1080 * 4,
        lastAccess: Date.now(),
        accessCount: 5,
      };

      expect(entry.key).toBe('source-1:frame-100');
      expect(entry.accessCount).toBe(5);
    });
  });
});
