import { describe, it, expect } from 'vitest';
import {
  checkWebCodecsSupport,
  checkVideoCodecSupport,
  checkAudioCodecSupport,
  getVideoDecoderPath,
  getAudioDecoderPath,
  parseVideoCodec,
  parseAudioCodec,
  checkAllCodecSupport,
} from './codec-support';

describe('Codec Support', () => {
  describe('checkWebCodecsSupport', () => {
    it('should detect WebCodecs availability', () => {
      const support = checkWebCodecsSupport();

      expect(support).toHaveProperty('available');
      expect(support).toHaveProperty('videoDecoder');
      expect(support).toHaveProperty('audioDecoder');
      expect(support).toHaveProperty('videoEncoder');
      expect(support).toHaveProperty('audioEncoder');
    });

    it('should return boolean values', () => {
      const support = checkWebCodecsSupport();

      expect(typeof support.available).toBe('boolean');
      expect(typeof support.videoDecoder).toBe('boolean');
      expect(typeof support.audioDecoder).toBe('boolean');
    });
  });

  describe('getVideoDecoderPath', () => {
    it('should recommend webcodecs for H.264', () => {
      expect(getVideoDecoderPath('h264')).toBe('webcodecs');
    });

    it('should recommend webcodecs for VP9', () => {
      expect(getVideoDecoderPath('vp9')).toBe('webcodecs');
    });

    it('should recommend webcodecs for AV1', () => {
      expect(getVideoDecoderPath('av1')).toBe('webcodecs');
    });

    it('should recommend ffmpeg for ProRes', () => {
      expect(getVideoDecoderPath('prores')).toBe('ffmpeg');
    });

    it('should recommend ffmpeg for DNxHD', () => {
      expect(getVideoDecoderPath('dnxhd')).toBe('ffmpeg');
    });

    it('should recommend ffmpeg for HEVC', () => {
      expect(getVideoDecoderPath('h265')).toBe('ffmpeg');
    });

    it('should recommend ffmpeg for unknown codecs', () => {
      expect(getVideoDecoderPath('unknown')).toBe('ffmpeg');
    });
  });

  describe('getAudioDecoderPath', () => {
    it('should recommend webcodecs for AAC', () => {
      expect(getAudioDecoderPath('aac')).toBe('webcodecs');
    });

    it('should recommend webcodecs for MP3', () => {
      expect(getAudioDecoderPath('mp3')).toBe('webcodecs');
    });

    it('should recommend webcodecs for Opus', () => {
      expect(getAudioDecoderPath('opus')).toBe('webcodecs');
    });

    it('should recommend webcodecs for PCM', () => {
      expect(getAudioDecoderPath('pcm')).toBe('webcodecs');
    });

    it('should recommend ffmpeg for AC3', () => {
      expect(getAudioDecoderPath('ac3')).toBe('ffmpeg');
    });

    it('should recommend ffmpeg for E-AC3', () => {
      expect(getAudioDecoderPath('eac3')).toBe('ffmpeg');
    });
  });

  describe('parseVideoCodec', () => {
    it('should parse H.264 variants', () => {
      expect(parseVideoCodec('avc1.42E01E')).toBe('h264');
      expect(parseVideoCodec('H264')).toBe('h264');
      expect(parseVideoCodec('h.264')).toBe('h264');
    });

    it('should parse H.265/HEVC variants', () => {
      expect(parseVideoCodec('hvc1.1.6.L93')).toBe('h265');
      expect(parseVideoCodec('HEVC')).toBe('h265');
      expect(parseVideoCodec('h.265')).toBe('h265');
    });

    it('should parse VP8', () => {
      expect(parseVideoCodec('vp8')).toBe('vp8');
      expect(parseVideoCodec('VP8')).toBe('vp8');
    });

    it('should parse VP9', () => {
      expect(parseVideoCodec('vp9')).toBe('vp9');
      expect(parseVideoCodec('vp09.00.10.08')).toBe('vp9');
    });

    it('should parse AV1', () => {
      expect(parseVideoCodec('av1')).toBe('av1');
      expect(parseVideoCodec('av01.0.04M.08')).toBe('av1');
    });

    it('should parse ProRes', () => {
      expect(parseVideoCodec('prores')).toBe('prores');
      expect(parseVideoCodec('apch')).toBe('prores'); // ProRes 422 HQ
      expect(parseVideoCodec('apcn')).toBe('prores'); // ProRes 422
    });

    it('should parse DNxHD', () => {
      expect(parseVideoCodec('dnxhd')).toBe('dnxhd');
      expect(parseVideoCodec('AVdh')).toBe('dnxhd');
    });

    it('should parse MJPEG', () => {
      expect(parseVideoCodec('mjpeg')).toBe('mjpeg');
      expect(parseVideoCodec('MJPG')).toBe('mjpeg');
    });

    it('should parse MPEG-2', () => {
      expect(parseVideoCodec('mpeg2video')).toBe('mpeg2');
      expect(parseVideoCodec('mp2v')).toBe('mpeg2');
    });

    it('should parse MPEG-4 Part 2', () => {
      expect(parseVideoCodec('mpeg4')).toBe('mpeg4');
      expect(parseVideoCodec('DivX')).toBe('mpeg4');
      expect(parseVideoCodec('Xvid')).toBe('mpeg4');
    });

    it('should return unknown for unrecognized codecs', () => {
      expect(parseVideoCodec('some_weird_codec')).toBe('unknown');
    });
  });

  describe('parseAudioCodec', () => {
    it('should parse AAC', () => {
      expect(parseAudioCodec('aac')).toBe('aac');
      expect(parseAudioCodec('mp4a.40.2')).toBe('aac');
    });

    it('should parse MP3', () => {
      expect(parseAudioCodec('mp3')).toBe('mp3');
      expect(parseAudioCodec('MPEG Audio')).toBe('mp3');
    });

    it('should parse Opus', () => {
      expect(parseAudioCodec('opus')).toBe('opus');
    });

    it('should parse Vorbis', () => {
      expect(parseAudioCodec('vorbis')).toBe('vorbis');
    });

    it('should parse FLAC', () => {
      expect(parseAudioCodec('flac')).toBe('flac');
    });

    it('should parse PCM', () => {
      expect(parseAudioCodec('pcm_s16le')).toBe('pcm');
      expect(parseAudioCodec('LPCM')).toBe('pcm');
    });

    it('should parse AC3', () => {
      expect(parseAudioCodec('ac3')).toBe('ac3');
      expect(parseAudioCodec('AC-3')).toBe('ac3');
    });

    it('should parse E-AC3', () => {
      expect(parseAudioCodec('eac3')).toBe('eac3');
      expect(parseAudioCodec('E-AC-3')).toBe('eac3');
    });

    it('should parse ALAC', () => {
      expect(parseAudioCodec('alac')).toBe('alac');
    });

    it('should return unknown for unrecognized codecs', () => {
      expect(parseAudioCodec('weird_audio_codec')).toBe('unknown');
    });
  });

  describe('checkVideoCodecSupport', () => {
    it('should return support result for H.264', async () => {
      const result = await checkVideoCodecSupport('h264');

      expect(result.codec).toBe('h264');
      expect(result.supported).toBe(true);
      expect(['webcodecs', 'ffmpeg']).toContain(result.decoderPath);
    });

    it('should return FFmpeg path for ProRes', async () => {
      const result = await checkVideoCodecSupport('prores');

      expect(result.codec).toBe('prores');
      expect(result.supported).toBe(true);
      expect(result.decoderPath).toBe('ffmpeg');
    });

    it('should return FFmpeg path for DNxHD', async () => {
      const result = await checkVideoCodecSupport('dnxhd');

      expect(result.codec).toBe('dnxhd');
      expect(result.supported).toBe(true);
      expect(result.decoderPath).toBe('ffmpeg');
    });
  });

  describe('checkAudioCodecSupport', () => {
    it('should return support result for AAC', async () => {
      const result = await checkAudioCodecSupport('aac');

      expect(result.codec).toBe('aac');
      expect(result.supported).toBe(true);
      expect(['webcodecs', 'ffmpeg']).toContain(result.decoderPath);
    });

    it('should handle PCM specially', async () => {
      const result = await checkAudioCodecSupport('pcm');

      expect(result.codec).toBe('pcm');
      expect(result.supported).toBe(true);
      expect(result.decoderPath).toBe('webcodecs'); // Native handling
    });

    it('should return FFmpeg path for AC3', async () => {
      const result = await checkAudioCodecSupport('ac3');

      expect(result.codec).toBe('ac3');
      expect(result.supported).toBe(true);
      expect(result.decoderPath).toBe('ffmpeg');
    });
  });

  describe('checkAllCodecSupport', () => {
    it('should return support maps for video and audio', async () => {
      const support = await checkAllCodecSupport();

      expect(support.video).toBeInstanceOf(Map);
      expect(support.audio).toBeInstanceOf(Map);
    });

    it('should include common video codecs', async () => {
      const support = await checkAllCodecSupport();

      expect(support.video.has('h264')).toBe(true);
      expect(support.video.has('vp9')).toBe(true);
      expect(support.video.has('prores')).toBe(true);
    });

    it('should include common audio codecs', async () => {
      const support = await checkAllCodecSupport();

      expect(support.audio.has('aac')).toBe(true);
      expect(support.audio.has('mp3')).toBe(true);
      expect(support.audio.has('opus')).toBe(true);
    });
  });
});
