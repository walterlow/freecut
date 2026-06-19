import { memo, useMemo } from 'react'
import type { TimelineTrack } from '@/types/timeline'
import type { MiniTimelineClip } from './types'

/**
 * Track label gutter + lane dividers + the compact clip bars. Clip selection is
 * delegated to `onSelectClip` so the Color (seek + select) and Animate (pick
 * animation target) workspaces can supply their own behavior.
 */
export const MiniTimelineTrackLanes = memo(function MiniTimelineTrackLanes({
  tracks,
  clips,
  selectedIds,
  maxFrame,
  trackAreaHeight,
  labelWidth,
  onSelectClip,
  fallbackLabelPrefix = 'V',
  clipTestId,
  mutedClipIds,
}: {
  tracks: readonly TimelineTrack[]
  clips: readonly MiniTimelineClip[]
  selectedIds: ReadonlySet<string>
  maxFrame: number
  trackAreaHeight: number
  labelWidth: number
  onSelectClip: (clip: MiniTimelineClip) => void
  fallbackLabelPrefix?: string
  clipTestId?: string
  /**
   * Clips drawn as dimmed, secondary context rather than primary targets (e.g.
   * a linked-audio companion in the Animate workspace). Still clickable —
   * `onSelectClip` is expected to forward the press to the primary partner.
   */
  mutedClipIds?: ReadonlySet<string>
}) {
  const laneIndexById = useMemo(
    () => new Map(tracks.map((track, index) => [track.id, index])),
    [tracks],
  )
  const rowCount = Math.max(1, tracks.length)
  const rowHeight = trackAreaHeight / rowCount

  return (
    <div className="relative" style={{ height: trackAreaHeight }}>
      <div
        className="absolute left-0 top-0 h-full border-r border-black/35 text-[9px] font-semibold text-zinc-400"
        style={{ width: labelWidth }}
      >
        {tracks.length > 0 ? (
          tracks.map((track, index) => (
            <span
              key={track.id}
              className="absolute left-0 flex w-full items-center justify-center overflow-hidden leading-none"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {track.name || `${fallbackLabelPrefix}${index + 1}`}
            </span>
          ))
        ) : (
          <span className="flex h-full items-center justify-center">{`${fallbackLabelPrefix}1`}</span>
        )}
      </div>
      <div className="absolute inset-y-0 right-0" style={{ left: labelWidth }}>
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="absolute left-0 right-0 border-t border-zinc-700/70"
            style={{ top: index * rowHeight }}
          />
        ))}
        {clips.map((clip) => {
          const selected = selectedIds.has(clip.id)
          const muted = mutedClipIds?.has(clip.id) ?? false
          const laneIndex = laneIndexById.get(clip.trackId) ?? 0
          const clipHeight =
            rowHeight >= 10 ? Math.max(8, Math.min(16, rowHeight - 4)) : Math.max(4, rowHeight - 2)
          const clipTop = laneIndex * rowHeight + Math.max(1, (rowHeight - clipHeight) / 2)
          const clipTone = selected
            ? 'border-orange-500 bg-orange-500/20 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
            : muted
              ? 'border-zinc-600/60 bg-zinc-500/20 opacity-70 hover:opacity-100'
              : 'border-sky-500/70 bg-sky-500/45 hover:border-sky-300'
          return (
            <button
              key={`${clip.id}-mini`}
              type="button"
              data-testid={clipTestId}
              data-track-id={clip.trackId}
              data-muted={muted ? '1' : undefined}
              className={`absolute overflow-hidden rounded-[2px] border text-left transition-colors ${clipTone}`}
              style={{
                left: `${(clip.from / maxFrame) * 100}%`,
                width: `${Math.max(0.6, (clip.durationInFrames / maxFrame) * 100)}%`,
                minWidth: 16,
                top: clipTop,
                height: clipHeight,
              }}
              onClick={(event) => {
                event.stopPropagation()
                onSelectClip(clip)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title={clip.label}
              aria-label={clip.label}
            />
          )
        })}
      </div>
    </div>
  )
})
