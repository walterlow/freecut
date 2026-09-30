import { describe, expect, it } from 'vite-plus/test'
import {
  getMediaType,
  getMimeType,
  validateMediaFile,
  validateMediaFileContent,
} from '@/features/media-library/utils/validation'

// jsdom's File omits arrayBuffer(); give each instance its own so the
// content-aware validator can read bytes without a global polyfill (which would
// activate arrayBuffer-dependent paths in unrelated test files).
function jsonFile(content: string, name: string, type = ''): File {
  const file = new File([content], name, { type })
  const bytes = new TextEncoder().encode(content)
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.buffer,
  })
  return file
}

describe('validation', () => {
  it('prefers canonical extension MIME for alternate mkv browser values', () => {
    const file = new File(['data'], 'capture.mkv', { type: 'video/matroska' })

    expect(getMimeType(file)).toBe('video/x-matroska')
  })

  it('preserves browser MIME for ambiguous mp4 containers', () => {
    const file = new File(['data'], 'podcast.mp4', { type: 'audio/mp4' })

    expect(getMimeType(file)).toBe('audio/mp4')
  })

  it('accepts newly supported avi, m4a, and svg files', () => {
    const avi = new File(['data'], 'clip.avi', { type: 'video/x-msvideo' })
    const m4a = new File(['data'], 'voice.m4a', { type: 'audio/mp4' })
    const svg = new File(['<svg></svg>'], 'graphic.svg', { type: '' })

    expect(validateMediaFile(avi)).toEqual({ valid: true })
    expect(validateMediaFile(m4a)).toEqual({ valid: true })
    expect(validateMediaFile(svg)).toEqual({ valid: true })
  })

  it('accepts Insta360 native .insv and .insp files', () => {
    const insv = new File(['data'], 'insta_video.insv', { type: '' })
    const insp = new File(['data'], 'insta_photo.insp', { type: '' })

    expect(getMimeType(insv)).toBe('video/mp4')
    expect(getMimeType(insp)).toBe('image/jpeg')
    expect(getMediaType(getMimeType(insv))).toBe('video')
    expect(getMediaType(getMimeType(insp))).toBe('image')
    expect(validateMediaFile(insv)).toEqual({ valid: true })
    expect(validateMediaFile(insp)).toEqual({ valid: true })
  })

  it('classifies alternate supported MIME types correctly', () => {
    expect(getMediaType('video/matroska')).toBe('video')
    expect(getMediaType('audio/x-m4a')).toBe('audio')
    expect(getMediaType('audio/mp4')).toBe('audio')
    expect(getMediaType('image/svg+xml')).toBe('image')
  })

  it('classifies MediaRecorder voiceover output (WebM/Opus) as audio', () => {
    // The base container type must classify as audio...
    expect(getMediaType('audio/webm')).toBe('audio')
    // ...and the `;codecs=opus` suffix MediaRecorder appends must not defeat it.
    expect(getMediaType('audio/webm;codecs=opus')).toBe('audio')
    // A real WebM *video* file stays video.
    expect(getMediaType('video/webm')).toBe('video')
  })

  it('rejects a generic .json that maps to Lottie by extension but is not a Lottie', async () => {
    // Empty browser MIME forces the extension fallback, which types `.json` as Lottie.
    const notLottie = jsonFile(JSON.stringify({ hello: 'world' }), 'data.json')

    expect(validateMediaFile(notLottie)).toEqual({ valid: true })
    expect(await validateMediaFileContent(notLottie)).toEqual({
      valid: false,
      error: 'Not a valid Lottie animation: data.json',
    })
  })

  it('accepts a .json whose bytes actually parse as a Lottie animation', async () => {
    const lottie = jsonFile(
      JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 60, layers: [] }),
      'anim.json',
    )

    expect(await validateMediaFileContent(lottie)).toEqual({ valid: true })
  })

  it('resolves a .json reported as application/json to the Lottie MIME', () => {
    // Browsers commonly report `.json` as the non-media `application/json`;
    // it must still be treated as a Lottie candidate, not rejected outright.
    const file = new File(['{}'], 'spinner.json', { type: 'application/json' })

    expect(getMimeType(file)).toBe('application/lottie+json')
    expect(validateMediaFile(file)).toEqual({ valid: true })
  })

  it('accepts a Lottie .json even when the browser reports application/json', async () => {
    const lottie = jsonFile(
      JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 60, layers: [] }),
      'spinner.json',
      'application/json',
    )

    expect(await validateMediaFileContent(lottie)).toEqual({ valid: true })
  })
})
