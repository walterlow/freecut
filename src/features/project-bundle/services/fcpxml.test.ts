import { describe, it, expect } from 'vitest'
import { exportProjectFcpxml, exportProjectEdl, framesToTimecode } from './fcpxml-export-service'
import { parseEdl, parseFcpxml, timecodeToFrames } from './fcpxml-import-service'
import type { Project } from '@/types/project'

describe('FCPXML & EDL Interchange', () => {
  it('converts frames to timecode and back', () => {
    const fps = 30
    const frames = 30 * 65 + 12 // 00:01:05:12
    const tc = framesToTimecode(frames, fps)
    expect(tc).toBe('00:01:05:12')
    expect(timecodeToFrames(tc, fps)).toBe(frames)
  })

  it('exports and parses EDL', () => {
    const mockProject: Project = {
      id: 'proj-1',
      name: 'Test Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: {
        fps: 30,
        tracks: [
          {
            id: 'v1',
            name: 'V1',
            kind: 'video',
            height: 72,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [
              {
                id: 'clip-1',
                type: 'video',
                trackId: 'v1',
                from: 0,
                durationInFrames: 90,
                label: 'Intro.mp4',
                sourceStart: 30,
              },
              {
                id: 'clip-2',
                type: 'video',
                trackId: 'v1',
                from: 90,
                durationInFrames: 60,
                label: 'Main.mp4',
                sourceStart: 0,
              },
            ],
          },
        ],
      },
    }

    const edl = exportProjectEdl(mockProject)
    expect(edl).toContain('TITLE: TEST PROJECT')
    expect(edl).toContain('001  AX')
    expect(edl).toContain('* FROM CLIP NAME: Intro.mp4')

    const parsed = parseEdl(edl, 30)
    expect(parsed.events.length).toBe(2)
    expect(parsed.events[0]?.clipName).toBe('Intro.mp4')
    expect(parsed.events[0]?.timelineStartFrames).toBe(0)
    expect(parsed.events[0]?.durationFrames).toBe(90)
    expect(parsed.events[1]?.clipName).toBe('Main.mp4')
    expect(parsed.events[1]?.timelineStartFrames).toBe(90)
    expect(parsed.events[1]?.durationFrames).toBe(60)
  })

  it('exports valid FCPXML', () => {
    const mockProject: Project = {
      id: 'proj-1',
      name: 'FCPXML Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: {
        width: 1920,
        height: 1080,
      },
      timeline: {
        fps: 30,
        tracks: [
          {
            id: 'v1',
            name: 'V1',
            kind: 'video',
            height: 72,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: [
              {
                id: 'clip-1',
                type: 'video',
                trackId: 'v1',
                from: 0,
                durationInFrames: 120,
                label: 'Shot 1',
              },
            ],
          },
        ],
      },
    }

    const fcpxml = exportProjectFcpxml(mockProject)
    expect(fcpxml).toContain('<fcpxml version="1.9">')
    expect(fcpxml).toContain('<project name="FCPXML Test">')
    expect(fcpxml).toContain('<clip name="Shot 1"')
  })
})
