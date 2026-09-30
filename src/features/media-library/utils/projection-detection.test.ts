import { describe, expect, it } from 'vite-plus/test'
import { detectVideoProjectionFormat } from './projection-detection'

describe('detectVideoProjectionFormat', () => {
  it('detects spherical 360 when sv3d box is present in binary header', async () => {
    const data = new Uint8Array(1024)
    const enc = new TextEncoder()
    data.set(enc.encode('....moov....trak....mdia....minf....stbl....stsd....sv3d....'), 50)
    const file = new File([data], 'video.mp4', { type: 'video/mp4' })

    const result = await detectVideoProjectionFormat(file, 3840, 1920)
    expect(result).toBe('spherical_360')
  })

  it('detects spherical 360 when Google Spatial Media UUID is present', async () => {
    const data = new Uint8Array(1024)
    data.set([0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd], 100)
    const file = new File([data], 'footage.mp4', { type: 'video/mp4' })

    const result = await detectVideoProjectionFormat(file, 1920, 1080)
    expect(result).toBe('spherical_360')
  })

  it('detects ultrawide when aspect ratio is 21:9 or >= 1.85:1 without 360 metadata', async () => {
    const data = new Uint8Array(1024)
    const file = new File([data], 'action_camera.mp4', { type: 'video/mp4' })

    // 21:9 (2560x1080) -> aspect 2.37
    const result21_9 = await detectVideoProjectionFormat(file, 2560, 1080)
    expect(result21_9).toBe('ultrawide')

    // 2:1 flat (3840x1920) without 360 metadata
    const result2_1 = await detectVideoProjectionFormat(file, 3840, 1920)
    expect(result2_1).toBe('ultrawide')
  })

  it('detects ultrawide for Insta360 Ace / Ace Pro flat files', async () => {
    const data = new Uint8Array(1024)
    const file = new File([data], 'PRO_VID_20240925_120000_00_001.insv', { type: 'video/mp4' })

    const result = await detectVideoProjectionFormat(file, 3840, 2160)
    expect(result).toBe('ultrawide')
  })

  it('detects spherical 360 for twin-lens Insta360 360 files', async () => {
    const data = new Uint8Array(1024)
    const file = new File([data], 'VID_20240925_120000_00_360.insv', { type: 'video/mp4' })

    const result = await detectVideoProjectionFormat(file, 5760, 2880)
    expect(result).toBe('spherical_360')
  })

  it('detects standard for normal 16:9 video', async () => {
    const data = new Uint8Array(1024)
    const file = new File([data], 'clip.mp4', { type: 'video/mp4' })

    const result = await detectVideoProjectionFormat(file, 1920, 1080)
    expect(result).toBe('standard')
  })
})
