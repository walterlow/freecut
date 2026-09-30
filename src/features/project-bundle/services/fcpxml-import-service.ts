/**
 * FCPXML & CMX 3600 EDL Import Service
 *
 * Imports edits from Final Cut Pro XML or CMX 3600 EDL into FreeCut project timeline.
 */

import type { TimelineTrack, VideoItem } from '@/types/timeline'

export interface ImportedEditEvent {
  reel: string
  clipName: string
  sourceStartFrames: number
  sourceEndFrames: number
  timelineStartFrames: number
  timelineEndFrames: number
  durationFrames: number
}

export interface ImportedTimelineResult {
  fps: number
  tracks: TimelineTrack[]
  events: ImportedEditEvent[]
}

/**
 * Parse SMPTE timecode (HH:MM:SS:FF or HH:MM:SS;FF) to frames
 */
export function timecodeToFrames(timecode: string, fps: number): number {
  const parts = timecode.trim().split(/[:;]/).map((p) => Number.parseInt(p, 10))
  if (parts.length < 4 || parts.some(Number.isNaN)) {
    return 0
  }
  const [hh = 0, mm = 0, ss = 0, ff = 0] = parts
  return Math.round(hh * 3600 * fps + mm * 60 * fps + ss * fps + ff)
}

/**
 * Parse FCPXML fraction string (e.g. "100/3000s" or "5s") to frames
 */
export function fcpxmlTimeToFrames(timeStr: string, fps: number): number {
  const clean = timeStr.trim().replace(/s$/, '')
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map(Number)
    if (den && den > 0) {
      const seconds = num / den
      return Math.round(seconds * fps)
    }
  }
  const seconds = Number.parseFloat(clean)
  return Number.isNaN(seconds) ? 0 : Math.round(seconds * fps)
}

/**
 * Import a CMX 3600 EDL string
 */
export function parseEdl(edlText: string, defaultFps = 30): ImportedTimelineResult {
  const lines = edlText.split(/\r?\n/)
  const events: ImportedEditEvent[] = []
  let fps = defaultFps

  let currentClipName = 'Imported Clip'

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('* FROM CLIP NAME:')) {
      const parsedName = trimmed.replace('* FROM CLIP NAME:', '').trim()
      if (events.length > 0 && events[events.length - 1]!.clipName === 'Imported Clip') {
        events[events.length - 1]!.clipName = parsedName
      } else {
        currentClipName = parsedName
      }
      continue
    }

    // Match EDL line: 001  AX       V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00
    const match = trimmed.match(
      /^(\d+)\s+([^\s]+)\s+([VA]\d*)\s+([CDWP])(?:\s+\d+)?\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})/,
    )

    if (match) {
      const [, , reel = 'AX', , , srcInStr, srcOutStr, recInStr, recOutStr] = match
      const srcIn = timecodeToFrames(srcInStr!, fps)
      const srcOut = timecodeToFrames(srcOutStr!, fps)
      const recIn = timecodeToFrames(recInStr!, fps)
      const recOut = timecodeToFrames(recOutStr!, fps)
      const duration = Math.max(1, recOut - recIn)

      events.push({
        reel,
        clipName: currentClipName,
        sourceStartFrames: srcIn,
        sourceEndFrames: srcOut,
        timelineStartFrames: recIn,
        timelineEndFrames: recOut,
        durationFrames: duration,
      })

      currentClipName = 'Imported Clip'
    }
  }

  // Construct TimelineTrack
  const items: VideoItem[] = events.map((ev) => ({
    id: crypto.randomUUID(),
    type: 'video',
    trackId: 'track-v1',
    from: ev.timelineStartFrames,
    durationInFrames: ev.durationFrames,
    label: ev.clipName,
    sourceStart: ev.sourceStartFrames,
    sourceEnd: ev.sourceEndFrames,
    sourceFps: fps,
    speed: 1,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
    },
  }))

  const track: TimelineTrack = {
    id: 'track-v1',
    name: 'V1',
    kind: 'video',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }

  return {
    fps,
    tracks: [track],
    events,
  }
}

/**
 * Parse an FCPXML string using DOMParser
 */
export function parseFcpxml(fcpxmlText: string, defaultFps = 30): ImportedTimelineResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(fcpxmlText, 'application/xml')

  const formatElem = doc.querySelector('resources > format')
  let fps = defaultFps
  if (formatElem) {
    const frameDuration = formatElem.getAttribute('frameDuration')
    if (frameDuration) {
      const clean = frameDuration.replace(/s$/, '')
      if (clean.includes('/')) {
        const [num, den] = clean.split('/').map(Number)
        if (num && den) fps = Math.round(den / num)
      }
    }
  }

  // Map asset IDs to asset names
  const assetMap = new Map<string, string>()
  doc.querySelectorAll('resources > asset').forEach((asset) => {
    const id = asset.getAttribute('id')
    const name = asset.getAttribute('name') ?? 'Media'
    if (id) assetMap.set(id, name)
  })

  const events: ImportedEditEvent[] = []
  const clipElements = doc.querySelectorAll('spine > clip, spine > asset-clip')

  let currentTimelineFrames = 0

  clipElements.forEach((clip) => {
    const offsetStr = clip.getAttribute('offset')
    const durationStr = clip.getAttribute('duration')
    const startStr = clip.getAttribute('start')
    const name = clip.getAttribute('name') ?? 'Clip'

    const duration = durationStr ? fcpxmlTimeToFrames(durationStr, fps) : 30
    const offset = offsetStr ? fcpxmlTimeToFrames(offsetStr, fps) : currentTimelineFrames
    const start = startStr ? fcpxmlTimeToFrames(startStr, fps) : 0

    events.push({
      reel: 'FCPXML',
      clipName: name,
      sourceStartFrames: start,
      sourceEndFrames: start + duration,
      timelineStartFrames: offset,
      timelineEndFrames: offset + duration,
      durationFrames: duration,
    })

    currentTimelineFrames = offset + duration
  })

  const items: VideoItem[] = events.map((ev) => ({
    id: crypto.randomUUID(),
    type: 'video',
    trackId: 'track-v1',
    from: ev.timelineStartFrames,
    durationInFrames: ev.durationFrames,
    label: ev.clipName,
    sourceStart: ev.sourceStartFrames,
    sourceEnd: ev.sourceEndFrames,
    sourceFps: fps,
    speed: 1,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
    },
  }))

  const track: TimelineTrack = {
    id: 'track-v1',
    name: 'V1',
    kind: 'video',
    height: 72,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items,
  }

  return {
    fps,
    tracks: [track],
    events,
  }
}
