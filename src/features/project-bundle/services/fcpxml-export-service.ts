/**
 * FCPXML & CMX 3600 EDL Export Service
 *
 * Provides bidirectional interchange with professional NLEs
 * (Final Cut Pro, DaVinci Resolve, Premiere Pro).
 */

import type { Project } from '@/types/project'
import type { TimelineTrack, TimelineItem, VideoItem, AudioItem } from '@/types/timeline'

/**
 * Format frames as standard SMPTE timecode (HH:MM:SS:FF)
 */
export function framesToTimecode(totalFrames: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  const frames = Math.max(0, Math.floor(totalFrames))
  const ff = frames % safeFps
  const totalSeconds = Math.floor(frames / safeFps)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/**
 * Convert timeline frames to FCPXML fraction string e.g. "120/30s"
 */
function framesToFcpxmlTime(frames: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  return `${Math.round(frames * 100)}/${safeFps * 100}s`
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generate FCPXML 1.9 document string from FreeCut project
 */
export function exportProjectFcpxml(project: Project): string {
  const fps = Math.round(project.timeline?.fps ?? 30)
  const width = project.settings?.width ?? 1920
  const height = project.settings?.height ?? 1080
  const tracks: TimelineTrack[] = project.timeline?.tracks ?? []

  // Collect all unique media assets
  const assetMap = new Map<string, { id: string; name: string; src: string; duration: number }>()
  let assetCounter = 1

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if ((item.type === 'video' || item.type === 'audio') && item.mediaId) {
        if (!assetMap.has(item.mediaId)) {
          assetMap.set(item.mediaId, {
            id: `r${++assetCounter}`,
            name: item.label ?? `Media_${item.mediaId.slice(0, 8)}`,
            src: `file://localhost/${encodeURIComponent(item.label ?? 'media')}`,
            duration: item.durationInFrames,
          })
        }
      }
    }
  }

  // Find max duration in frames
  let maxDurationInFrames = 0
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      const end = item.from + item.durationInFrames
      if (end > maxDurationInFrames) maxDurationInFrames = end
    }
  }

  const primaryVideoTrack = tracks.find((t) => t.kind === 'video' || !t.kind) ?? tracks[0]
  const spineItems: TimelineItem[] = primaryVideoTrack ? [...(primaryVideoTrack.items ?? [])].sort((a, b) => a.from - b.from) : []

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<!DOCTYPE fcpxml>\n`
  xml += `<fcpxml version="1.9">\n`
  xml += `  <resources>\n`
  xml += `    <format id="r1" name="FFVideoFormat${height}p" frameDuration="100/${fps * 100}s" width="${width}" height="${height}"/>\n`

  for (const asset of assetMap.values()) {
    xml += `    <asset id="${asset.id}" name="${escapeXml(asset.name)}" src="${escapeXml(asset.src)}" start="0s" duration="${framesToFcpxmlTime(asset.duration, fps)}" hasVideo="1" hasAudio="1"/>\n`
  }
  xml += `  </resources>\n`

  xml += `  <library>\n`
  xml += `    <event name="FreeCut Exports">\n`
  xml += `      <project name="${escapeXml(project.name)}">\n`
  xml += `        <sequence format="r1" duration="${framesToFcpxmlTime(maxDurationInFrames, fps)}" tcStart="0s" tcFormat="NDF">\n`
  xml += `          <spine>\n`

  let currentTimelineFrame = 0
  for (const item of spineItems) {
    // Gap before clip if needed
    if (item.from > currentTimelineFrame) {
      const gapDuration = item.from - currentTimelineFrame
      xml += `            <gap name="Gap" offset="${framesToFcpxmlTime(currentTimelineFrame, fps)}" duration="${framesToFcpxmlTime(gapDuration, fps)}" start="0s"/>\n`
      currentTimelineFrame = item.from
    }

    const assetRef = item.mediaId ? assetMap.get(item.mediaId) : undefined
    const assetId = assetRef ? assetRef.id : 'r1'
    const clipName = escapeXml(item.label ?? item.id)
    const clipDuration = item.durationInFrames
    const sourceStart = (item as VideoItem | AudioItem).sourceStart ?? 0

    xml += `            <clip name="${clipName}" offset="${framesToFcpxmlTime(item.from, fps)}" duration="${framesToFcpxmlTime(clipDuration, fps)}" start="${framesToFcpxmlTime(sourceStart, fps)}">\n`
    xml += `              <video ref="${assetId}" duration="${framesToFcpxmlTime(clipDuration, fps)}" start="${framesToFcpxmlTime(sourceStart, fps)}"/>\n`
    xml += `            </clip>\n`

    currentTimelineFrame = item.from + item.durationInFrames
  }

  xml += `          </spine>\n`
  xml += `        </sequence>\n`
  xml += `      </project>\n`
  xml += `    </event>\n`
  xml += `  </library>\n`
  xml += `</fcpxml>\n`

  return xml
}

/**
 * Generate CMX 3600 standard EDL string from FreeCut project
 */
export function exportProjectEdl(project: Project): string {
  const fps = Math.round(project.timeline?.fps ?? 30)
  const tracks: TimelineTrack[] = project.timeline?.tracks ?? []

  let edl = `TITLE: ${project.name.toUpperCase()}\n`
  edl += `FCM: NON-DROP FRAME\n\n`

  // Gather video items across tracks sorted by timeline position
  const videoClips: Array<{ item: VideoItem; trackIndex: number }> = []

  tracks.forEach((track, trackIndex) => {
    for (const item of track.items ?? []) {
      if (item.type === 'video') {
        videoClips.push({ item: item as VideoItem, trackIndex })
      }
    }
  })

  videoClips.sort((a, b) => a.item.from - b.item.from)

  videoClips.forEach(({ item }, index) => {
    const eventNum = String(index + 1).padStart(3, '0')
    const reel = 'AX'
    const track = 'V'
    const cutType = 'C'

    const srcInFrames = item.sourceStart ?? 0
    const srcOutFrames = srcInFrames + item.durationInFrames
    const recInFrames = item.from
    const recOutFrames = item.from + item.durationInFrames

    const srcIn = framesToTimecode(srcInFrames, fps)
    const srcOut = framesToTimecode(srcOutFrames, fps)
    const recIn = framesToTimecode(recInFrames, fps)
    const recOut = framesToTimecode(recOutFrames, fps)

    edl += `${eventNum}  ${reel.padEnd(8)} ${track.padEnd(5)} ${cutType.padEnd(4)}    ${srcIn} ${srcOut} ${recIn} ${recOut}\n`
    edl += `* FROM CLIP NAME: ${item.label ?? item.mediaId ?? 'CLIP'}\n\n`
  })

  return edl
}
