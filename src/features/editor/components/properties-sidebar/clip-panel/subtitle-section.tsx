import { memo, useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { SubtitleSegmentItem, TimelineItem } from '@/types/timeline'

interface SubtitleSectionProps {
  items: TimelineItem[]
}

/**
 * Properties panel for selected subtitle segments.
 *
 * Per-segment style is layered on top of TextSection (which already renders
 * for text-like items via the synthetic-TextItem render path) — this panel
 * focuses on the things that are *unique* to a segment: the cue list. It
 * lets the user inspect cues, retime them, and edit text without leaving
 * the editor.
 */
export const SubtitleSection = memo(function SubtitleSection({ items }: SubtitleSectionProps) {
  const segments = useMemo(
    () => items.filter((item): item is SubtitleSegmentItem => item.type === 'subtitle'),
    [items],
  )

  if (segments.length === 0) return null

  // Multi-select shows aggregate stats; single-select gets the cue editor.
  if (segments.length > 1) {
    const totalCues = segments.reduce((sum, segment) => sum + segment.cues.length, 0)
    return (
      <section className="space-y-2 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Subtitles
        </h3>
        <p className="text-sm text-muted-foreground">
          {segments.length} segments selected · {totalCues} cues total. Select a single segment to
          edit individual cues.
        </p>
      </section>
    )
  }

  return <SingleSubtitleSegmentEditor segment={segments[0]!} />
})

interface SingleSubtitleSegmentEditorProps {
  segment: SubtitleSegmentItem
}

const SingleSubtitleSegmentEditor = memo(function SingleSubtitleSegmentEditor({
  segment,
}: SingleSubtitleSegmentEditorProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)

  const updateCue = useCallback(
    (cueId: string, patch: Partial<{ text: string; startSeconds: number; endSeconds: number }>) => {
      const next = segment.cues.map((cue) => (cue.id === cueId ? { ...cue, ...patch } : cue))
      updateItem(segment.id, { cues: next })
    },
    [segment.cues, segment.id, updateItem],
  )

  const sourceLabel =
    segment.source.type === 'embedded-subtitles'
      ? (segment.source.trackName ??
        segment.source.language ??
        `Track ${segment.source.trackNumber}`)
      : segment.source.fileName

  return (
    <section className="space-y-2 px-1">
      <header className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Subtitles
        </h3>
        <p className="text-xs text-muted-foreground">
          {segment.cues.length} cues · {sourceLabel}
        </p>
      </header>

      <Separator />

      <ScrollArea className="h-[40vh] pr-2">
        <ul className="flex flex-col gap-2 py-1">
          {segment.cues.map((cue, index) => (
            <SubtitleCueRow
              key={cue.id}
              index={index}
              cueId={cue.id}
              text={cue.text}
              startSeconds={cue.startSeconds}
              endSeconds={cue.endSeconds}
              onChange={updateCue}
            />
          ))}
        </ul>
      </ScrollArea>
    </section>
  )
})

interface SubtitleCueRowProps {
  index: number
  cueId: string
  text: string
  startSeconds: number
  endSeconds: number
  onChange: (
    cueId: string,
    patch: Partial<{ text: string; startSeconds: number; endSeconds: number }>,
  ) => void
}

const SubtitleCueRow = memo(function SubtitleCueRow({
  index,
  cueId,
  text,
  startSeconds,
  endSeconds,
  onChange,
}: SubtitleCueRowProps) {
  return (
    <li className="rounded border border-border bg-card/40 p-2">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
          #{index + 1}
        </span>
        <Label className="sr-only" htmlFor={`cue-${cueId}-start`}>
          Start
        </Label>
        <Input
          id={`cue-${cueId}-start`}
          type="number"
          step="0.01"
          min="0"
          value={Number(startSeconds.toFixed(3))}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) onChange(cueId, { startSeconds: Math.max(0, value) })
          }}
          className="h-6 w-20 text-xs tabular-nums"
        />
        <span className="text-[10px] text-muted-foreground">→</span>
        <Label className="sr-only" htmlFor={`cue-${cueId}-end`}>
          End
        </Label>
        <Input
          id={`cue-${cueId}-end`}
          type="number"
          step="0.01"
          min="0"
          value={Number(endSeconds.toFixed(3))}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) onChange(cueId, { endSeconds: Math.max(0, value) })
          }}
          className="h-6 w-20 text-xs tabular-nums"
        />
      </div>
      <textarea
        value={text}
        onChange={(event) => onChange(cueId, { text: event.target.value })}
        rows={2}
        className="w-full resize-none rounded border border-input bg-transparent px-2 py-1 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </li>
  )
})
