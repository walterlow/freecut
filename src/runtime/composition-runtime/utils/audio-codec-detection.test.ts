import { describe, expect, it } from 'vite-plus/test'
import { isNonNativeAudioContainer, needsCustomAudioDecoder } from './audio-codec-detection'

describe('needsCustomAudioDecoder', () => {
  it('detects AC-3/E-AC-3 codecs', () => {
    expect(needsCustomAudioDecoder('ac-3')).toBe(true)
    expect(needsCustomAudioDecoder('ec-3')).toBe(true)
    expect(needsCustomAudioDecoder('Dolby Digital Plus')).toBe(true)
  })

  it('detects vorbis codecs', () => {
    expect(needsCustomAudioDecoder('vorbis')).toBe(true)
    expect(needsCustomAudioDecoder('xiph.vorbis')).toBe(true)
  })

  it('detects PCM endian codec ids', () => {
    expect(needsCustomAudioDecoder('pcm-s16be')).toBe(true)
    expect(needsCustomAudioDecoder('pcm-s24le')).toBe(true)
    expect(needsCustomAudioDecoder('pcm-f64be')).toBe(true)
    expect(needsCustomAudioDecoder('PCM Little Endian')).toBe(true)
  })

  it('detects common quicktime/aiff pcm aliases', () => {
    expect(needsCustomAudioDecoder('twos')).toBe(true)
    expect(needsCustomAudioDecoder('sowt')).toBe(true)
    expect(needsCustomAudioDecoder('lpcm')).toBe(true)
  })

  it('returns false for standard browser-decodable codecs', () => {
    expect(needsCustomAudioDecoder(undefined)).toBe(false)
    expect(needsCustomAudioDecoder('aac')).toBe(false)
    expect(needsCustomAudioDecoder('opus')).toBe(false)
  })
})

describe('isNonNativeAudioContainer', () => {
  it('flags Matroska by mime type', () => {
    expect(isNonNativeAudioContainer('video/x-matroska', undefined)).toBe(true)
    expect(isNonNativeAudioContainer('audio/x-matroska', undefined)).toBe(true)
    expect(isNonNativeAudioContainer('video/x-matroska; codecs="vp9,opus"', undefined)).toBe(true)
  })

  it('flags Matroska by file extension', () => {
    expect(isNonNativeAudioContainer(undefined, 'Sacrifice.mkv')).toBe(true)
    expect(isNonNativeAudioContainer(undefined, 'audio-only.mka')).toBe(true)
    expect(isNonNativeAudioContainer('', 'UPPERCASE.MKV')).toBe(true)
  })

  it('does not flag natively demuxable containers', () => {
    expect(isNonNativeAudioContainer(undefined, undefined)).toBe(false)
    expect(isNonNativeAudioContainer('video/mp4', 'clip.mp4')).toBe(false)
    expect(isNonNativeAudioContainer('video/webm', 'clip.webm')).toBe(false)
    expect(isNonNativeAudioContainer('audio/mpeg', 'song.mp3')).toBe(false)
  })
})
