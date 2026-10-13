// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { interpolatedFileName } from './frame-interpolation-constants'

describe('interpolatedFileName', () => {
  it('replaces the extension and labels the new frame rate', () => {
    expect(interpolatedFileName('beach.mp4', 120)).toBe('beach (120fps).mp4')
  })

  it('always outputs .mp4 regardless of source container', () => {
    expect(interpolatedFileName('clip.mov', 60)).toBe('clip (60fps).mp4')
    expect(interpolatedFileName('clip.mkv', 60)).toBe('clip (60fps).mp4')
  })

  it('keeps dots that are part of the name, stripping only the last extension', () => {
    expect(interpolatedFileName('take.02.final.mov', 96)).toBe('take.02.final (96fps).mp4')
  })

  it('handles a name with no extension', () => {
    expect(interpolatedFileName('rushes', 48)).toBe('rushes (48fps).mp4')
  })

  it('does not treat a leading dot as an extension separator', () => {
    expect(interpolatedFileName('.hidden', 48)).toBe('.hidden (48fps).mp4')
  })

  it('rounds fractional rates to two decimals so 23.976x4 stays readable', () => {
    // 24000/1001 * 4 = 95.904095...
    expect(interpolatedFileName('a.mp4', (24000 / 1001) * 4)).toBe('a (95.9fps).mp4')
    expect(interpolatedFileName('b.mp4', 119.88011988)).toBe('b (119.88fps).mp4')
  })
})
