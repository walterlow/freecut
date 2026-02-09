import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WebCodecsDecoder,
  createWebCodecsDecoder,
  isWebCodecsAvailable,
  getWebCodecsVideoCodec,
  getWebCodecsAudioCodec,
} from './webcodecs-decoder';

describe('WebCodecs Decoder', () => {
  describe('createWebCodecsDecoder', () => {
    it('should create a decoder instance', () => {
      const decoder = createWebCodecsDecoder();

      expect(decoder).toBeInstanceOf(WebCodecsDecoder);
      expect(decoder.type).toBe('webcodecs');
    });

    it('should start in unconfigured state', () => {
      const decoder = createWebCodecsDecoder();

      expect(decoder.state).toBe('unconfigured');
    });
  });

  describe('canDecode', () => {
    let decoder: WebCodecsDecoder;

    beforeEach(() => {
      decoder = createWebCodecsDecoder();
    });

    it('should return true for H.264', () => {
      expect(decoder.canDecode('h264')).toBe(true);
    });

    it('should return true for VP9', () => {
      expect(decoder.canDecode('vp9')).toBe(true);
    });

    it('should return true for AV1', () => {
      expect(decoder.canDecode('av1')).toBe(true);
    });

    it('should return false for ProRes', () => {
      expect(decoder.canDecode('prores')).toBe(false);
    });

    it('should return false for DNxHD', () => {
      expect(decoder.canDecode('dnxhd')).toBe(false);
    });

    it('should return true for AAC', () => {
      expect(decoder.canDecode('aac')).toBe(true);
    });

    it('should return true for Opus', () => {
      expect(decoder.canDecode('opus')).toBe(true);
    });

    it('should return false for AC3', () => {
      expect(decoder.canDecode('ac3')).toBe(false);
    });
  });

  describe('getWebCodecsVideoCodec', () => {
    it('should return H.264 codec string', () => {
      const codec = getWebCodecsVideoCodec('h264');
      expect(codec).toBe('avc1.42E01E');
    });

    it('should return custom H.264 profile', () => {
      const codec = getWebCodecsVideoCodec('h264', 'avc1.64001f');
      expect(codec).toBe('avc1.64001f');
    });

    it('should return VP9 codec string', () => {
      const codec = getWebCodecsVideoCodec('vp9');
      expect(codec).toBe('vp09.00.10.08');
    });

    it('should return AV1 codec string', () => {
      const codec = getWebCodecsVideoCodec('av1');
      expect(codec).toBe('av01.0.04M.08');
    });

    it('should return null for unsupported codec', () => {
      const codec = getWebCodecsVideoCodec('prores');
      expect(codec).toBeNull();
    });
  });

  describe('getWebCodecsAudioCodec', () => {
    it('should return AAC codec string', () => {
      const codec = getWebCodecsAudioCodec('aac');
      expect(codec).toBe('mp4a.40.2');
    });

    it('should return MP3 codec string', () => {
      const codec = getWebCodecsAudioCodec('mp3');
      expect(codec).toBe('mp3');
    });

    it('should return Opus codec string', () => {
      const codec = getWebCodecsAudioCodec('opus');
      expect(codec).toBe('opus');
    });

    it('should return null for unsupported codec', () => {
      const codec = getWebCodecsAudioCodec('ac3');
      expect(codec).toBeNull();
    });
  });

  describe('decoder lifecycle', () => {
    let decoder: WebCodecsDecoder;

    beforeEach(() => {
      decoder = createWebCodecsDecoder();
    });

    afterEach(() => {
      if (decoder.state !== 'closed') {
        decoder.close();
      }
    });

    it('should close decoder', () => {
      decoder.close();

      expect(decoder.state).toBe('closed');
    });

    it('should throw when decoding without configuration', async () => {
      const chunk = {
        type: 'key' as const,
        timestamp: 0,
        data: new ArrayBuffer(100),
      };

      await expect(decoder.decodeVideo(chunk)).rejects.toThrow('not configured');
    });

    it('should reset decoder state', () => {
      decoder.reset();

      expect(decoder.state).toBe('unconfigured');
    });

    it('should get queue size', () => {
      const queueSize = decoder.getQueueSize();

      expect(queueSize).toHaveProperty('video');
      expect(queueSize).toHaveProperty('audio');
      expect(queueSize.video).toBe(0);
      expect(queueSize.audio).toBe(0);
    });
  });

  describe('isWebCodecsAvailable', () => {
    it('should return a boolean', () => {
      const available = isWebCodecsAvailable();

      expect(typeof available).toBe('boolean');
    });
  });

  describe('codec string generation', () => {
    it('should generate VP8 codec string', () => {
      const codec = getWebCodecsVideoCodec('vp8');
      expect(codec).toBe('vp8');
    });

    it('should generate HEVC codec string', () => {
      const codec = getWebCodecsVideoCodec('h265');
      expect(codec).toBe('hvc1.1.6.L93.B0');
    });

    it('should generate Vorbis codec string', () => {
      const codec = getWebCodecsAudioCodec('vorbis');
      expect(codec).toBe('vorbis');
    });

    it('should generate FLAC codec string', () => {
      const codec = getWebCodecsAudioCodec('flac');
      expect(codec).toBe('flac');
    });
  });

  describe('hardware acceleration', () => {
    let decoder: WebCodecsDecoder;

    beforeEach(() => {
      decoder = createWebCodecsDecoder();
    });

    afterEach(() => {
      decoder.close();
    });

    it('should report hardware acceleration status', () => {
      const isHW = decoder.isHardwareAccelerated();

      expect(typeof isHW).toBe('boolean');
    });
  });
});
