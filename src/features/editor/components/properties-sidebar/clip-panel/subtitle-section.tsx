import { memo, useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  buildCueText,
  getCueFormatFlags,
  parseSubtitleCueText,
  toggleCueFormat,
  type CueFormatFlags,
} from '@/shared/utils/subtitle-cue-format'
import { cn } from '@/shared/ui/cn'
import type { SubtitleSegmentItem, TimelineItem } from '@/types/timeline'

import { CaptionStyleControls } from './caption-style-controls'

interface SubtitleSectionProps {
  items: TimelineItem[]
}

/**
 * Properties panel for selected subtitle segments.
 *
 * Renders three stacked blocks:
 *  1. Style presets + quick controls (font/color/position/background)
 *  2. Source label + cue count
 *  3. Cue list editor
 *
 * Multi-select hides the cue list (cue identities differ across segments)
 * but keeps style controls active so a "make all my subtitle tracks
 * Netflix-style" workflow takes one click.
 */
interface CanvasContext {
  width: number
  height: number
}

export interface SubtitleSectionPropsWithCanvas extends SubtitleSectionProps {
  canvas?: CanvasContext
}

export const SubtitleSection = memo(function SubtitleSection({
  items,
  canvas,
}: SubtitleSectionPropsWithCanvas) {
  const segments = useMemo(
    () => items.filter((item): item is SubtitleSegmentItem => item.type === 'subtitle'),
    [items],
  )

  if (segments.length === 0) return null

  const canvasHeight = canvas?.height ?? 1080

  if (segments.length > 1) {
    const totalCues = segments.reduce((sum, segment) => sum + segment.cues.length, 0)
    return (
      <section className="space-y-3 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Subtitles
        </h3>
        <CaptionStyleControls items={segments} canvasHeight={canvasHeight} />
        <Separator />
        <p className="text-xs text-muted-foreground">
          {segments.length} segments selected · {totalCues} cues total. Style applies to all. Select
          a single segment to edit individual cues.
        </p>
      </section>
    )
  }

  return <SingleSubtitleSegmentEditor segment={segments[0]!} canvasHeight={canvasHeight} />
})

interface SingleSubtitleSegmentEditorProps {
  segment: SubtitleSegmentItem
  canvasHeight: number
}

const SingleSubtitleSegmentEditor = memo(function SingleSubtitleSegmentEditor({
  segment,
  canvasHeight,
}: SingleSubtitleSegmentEditorProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)
  const fps = useTimelineStore((s) => s.fps)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)

  const updateCue = useCallback(
    (cueId: string, patch: Partial<{ text: string; startSeconds: number; endSeconds: number }>) => {
      const next = segment.cues.map((cue) => (cue.id === cueId ? { ...cue, ...patch } : cue))
      updateItem(segment.id, { cues: next })
    },
    [segment.cues, segment.id, updateItem],
  )

  const seekToCue = useCallback(
    (startSeconds: number) => {
      const targetFrame = segment.from + Math.round(startSeconds * fps)
      setCurrentFrame(Math.max(0, targetFrame))
    },
    [fps, segment.from, setCurrentFrame],
  )

  const sourceLabel =
    segment.source.type === 'embedded-subtitles'
      ? (segment.source.trackName ??
        segment.source.language ??
        `Track ${segment.source.trackNumber}`)
      : segment.source.fileName

  // Memoize the items array passed to CaptionStyleControls so identity is
  // stable across re-renders that don't actually change the segment object.
  const styleItems = useMemo(() => [segment], [segment])

  return (
    <section className="space-y-3 px-1">
      <header className="space-y-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Subtitles
        </h3>
        <p className="text-xs text-muted-foreground">
          {segment.cues.length} cues · {sourceLabel}
        </p>
      </header>

      <CaptionStyleControls items={styleItems} canvasHeight={canvasHeight} />

      <Separator />

      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Cues
      </p>
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
              onSeek={seekToCue}
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
  onSeek?: (startSeconds: number) => void
}

/**
 * Editor row for a single cue.
 *
 * The textarea shows plain text — markup is hidden so users don't see
 * literal `<i>` brackets. The Italic/Bold/Underline toggles below wrap
 * (or unwrap) the entire cue with the corresponding tag, and any ASS
 * `{\anN}` alignment in the original cue text is preserved across edits.
 *
 * Trade-off: cues with mixed-run formatting (e.g. half italic) collapse
 * to whole-cue formatting on first text edit. That's rare in real subs
 * and the alternative — rich-text editing — is a much bigger surface.
 */
const SubtitleCueRow = memo(function SubtitleCueRow({
  index,
  cueId,
  text,
  startSeconds,
  endSeconds,
  onChange,
  onSeek,
}: SubtitleCueRowProps) {
  const parsed = useMemo(() => parseSubtitleCueText(text), [text])
  const flags = useMemo(() => getCueFormatFlags(parsed), [parsed])

  const handlePlainTextChange = useCallback(
    (nextPlainText: string) => {
      onChange(cueId, { text: buildCueText(nextPlainText, flags, text) })
    },
    [cueId, flags, onChange, text],
  )

  const handleToggle = useCallback(
    (format: keyof CueFormatFlags) => {
      onChange(cueId, { text: toggleCueFormat(text, format) })
    },
    [cueId, onChange, text],
  )

  return (
    <li className="rounded border border-border bg-card/40 p-2">
      <div className="flex items-center gap-2 pb-1.5">
        <button
          type="button"
          title="Seek playhead to this cue"
          onClick={() => onSeek?.(startSeconds)}
          className="rounded text-[10px] font-semibold uppercase tracking-wide tabular-nums px-1.5 py-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
        >
          #{index + 1}
        </button>
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
        value={parsed.plainText}
        onChange={(event) => handlePlainTextChange(event.target.value)}
        rows={2}
        className="w-full resize-none rounded border border-input bg-transparent px-2 py-1 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center gap-1 pt-1">
        <FormatToggleButton
          active={flags.italic}
          onClick={() => handleToggle('italic')}
          label="Italic"
          glyph="I"
          glyphStyle={{ fontStyle: 'italic' }}
        />
        <FormatToggleButton
          active={flags.bold}
          onClick={() => handleToggle('bold')}
          label="Bold"
          glyph="B"
          glyphStyle={{ fontWeight: 700 }}
        />
        <FormatToggleButton
          active={flags.underline}
          onClick={() => handleToggle('underline')}
          label="Underline"
          glyph="U"
          glyphStyle={{ textDecoration: 'underline' }}
        />
        {parsed.alignment && (
          <span
            className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground"
            title={`Cue position: ${parsed.alignment.verticalAlign} ${parsed.alignment.textAlign}`}
          >
            {parsed.alignment.verticalAlign === 'top'
              ? '▲'
              : parsed.alignment.verticalAlign === 'bottom'
                ? '▼'
                : '◆'}{' '}
            {parsed.alignment.textAlign}
          </span>
        )}
      </div>
    </li>
  )
})

interface FormatToggleButtonProps {
  active: boolean
  onClick: () => void
  label: string
  glyph: string
  glyphStyle?: React.CSSProperties
}

function FormatToggleButton({
  active,
  onClick,
  label,
  glyph,
  glyphStyle,
}: FormatToggleButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-5 w-5 rounded border text-[11px] leading-none transition-colors',
        active
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-border text-muted-foreground hover:bg-secondary/40',
      )}
      style={glyphStyle}
    >
      {glyph}
    </button>
  )
}
