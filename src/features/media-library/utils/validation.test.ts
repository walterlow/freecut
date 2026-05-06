import { describe, expect, it } from 'vite-plus/test'
import {
  getMediaType,
  getMimeType,
  validateMediaFile,
} from '@/features/media-library/utils/validation'

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

  it('classifies alternate supported MIME types correctly', () => {
    expect(getMediaType('video/matroska')).toBe('video')
    expect(getMediaType('audio/x-m4a')).toBe('audio')
    expect(getMediaType('audio/mp4')).toBe('audio')
    expect(getMediaType('image/svg+xml')).toBe('image')
  })
})
