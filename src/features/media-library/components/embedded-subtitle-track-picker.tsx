import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/shared/ui/cn'
import type { EmbeddedSubtitleTrack } from '@/shared/utils/matroska-subtitles'
import type { MediaMetadata } from '@/types/storage'

import {
  chooseEmbeddedSubtitleTrackForMedia,
  getEmbeddedSubtitleTrackLabel,
  subtitleSidecarService,
} from '../services/subtitle-sidecar-service'

interface EmbeddedSubtitleTrackPickerProps {
  /** When non-null, the picker is open scanning/listing tracks for this media. */
  media: MediaMetadata | null
  /** Resolved blob — caller is responsible for permission + opening. */
  blob: Blob | null
  onClose: () => void
  onTrackPicked: (track: EmbeddedSubtitleTrack) => void
  /** Optional notice rendered in the body (used to surface scan errors). */
  errorMessage?: string | null
  /** Insertion mode toggle: 'segment' (one item) vs 'per-cue' (one item per cue). */
  insertMode?: 'segment' | 'per-cue'
  onInsertModeChange?: (mode: 'segment' | 'per-cue') => void
}

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | {
      status: 'ready'
      tracks: readonly EmbeddedSubtitleTrack[]
      fromCache: boolean
      defaultTrackNumber: number | null
    }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export function EmbeddedSubtitleTrackPicker({
  media,
  blob,
  onClose,
  onTrackPicked,
  errorMessage,
  insertMode = 'segment',
  onInsertModeChange,
}: EmbeddedSubtitleTrackPickerProps) {
  const [state, setState] = useState<ScanState>({ status: 'idle' })
  const [selectedTrackNumber, setSelectedTrackNumber] = useState<number | null>(null)

  const isOpen = media !== null

  useEffect(() => {
    if (!media || !blob) {
      setState({ status: 'idle' })
      setSelectedTrackNumber(null)
      return
    }

    let cancelled = false
    setState({ status: 'scanning' })
    setSelectedTrackNumber(null)

    void subtitleSidecarService
      .scanEmbeddedSubtitleTracks(media, blob)
      .then((result) => {
        if (cancelled) return
        if (result.tracks.length === 0) {
          setState({ status: 'empty' })
          return
        }
        const defaultTrack = chooseEmbeddedSubtitleTrackForMedia(result.tracks)
        const defaultTrackNumber = defaultTrack?.trackNumber ?? null
        setState({
          status: 'ready',
          tracks: result.tracks,
          fromCache: result.fromCache,
          defaultTrackNumber,
        })
        setSelectedTrackNumber(defaultTrackNumber)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to scan embedded subtitles.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [media, blob])

  const selectedTrack =
    state.status === 'ready' && selectedTrackNumber !== null
      ? (state.tracks.find((track) => track.trackNumber === selectedTrackNumber) ?? null)
      : null

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Embedded subtitles</DialogTitle>
          <DialogDescription>
            {media
              ? `Pick a subtitle track to insert as captions for ${media.fileName}.`
              : 'Pick a subtitle track to insert as captions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-32 max-h-[55vh]">
          {state.status === 'scanning' && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Scanning source for subtitle tracks…
            </div>
          )}

          {state.status === 'empty' && (
            <p className="py-6 text-sm text-muted-foreground">
              No supported text-subtitle tracks were found in this file. Bitmap (image-based)
              subtitle tracks aren&apos;t currently supported.
            </p>
          )}

          {state.status === 'error' && (
            <p className="py-6 text-sm text-destructive">{state.message}</p>
          )}

          {state.status === 'ready' && (
            <ScrollArea className="h-full max-h-[55vh] pr-2">
              <ul className="flex flex-col gap-1.5">
                {state.tracks.map((track) => (
                  <TrackRow
                    key={track.trackNumber}
                    track={track}
                    selected={track.trackNumber === selectedTrackNumber}
                    isDefault={track.trackNumber === state.defaultTrackNumber}
                    onSelect={() => setSelectedTrackNumber(track.trackNumber)}
                  />
                ))}
              </ul>
              {state.fromCache && (
                <p className="pt-3 text-xs text-muted-foreground">Loaded from cache.</p>
              )}
            </ScrollArea>
          )}

          {errorMessage && <p className="pt-2 text-sm text-destructive">{errorMessage}</p>}
        </div>

        {onInsertModeChange && (
          <div className="pt-3 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pb-1.5">
              Insert as
            </p>
            <div className="flex gap-1.5">
              <ModeToggleButton
                active={insertMode === 'segment'}
                onClick={() => onInsertModeChange('segment')}
                label="One subtitle segment"
                hint="Single timeline item that owns all cues — drag, trim, restyle as one."
              />
              <ModeToggleButton
                active={insertMode === 'per-cue'}
                onClick={() => onInsertModeChange('per-cue')}
                label="One text item per cue"
                hint="Legacy behavior: stamps every cue as its own caption text item."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selectedTrack}
            onClick={() => {
              if (selectedTrack) onTrackPicked(selectedTrack)
            }}
          >
            Insert {selectedTrack ? `(${selectedTrack.cues.length} cues)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface TrackRowProps {
  track: EmbeddedSubtitleTrack
  selected: boolean
  isDefault: boolean
  onSelect: () => void
}

function TrackRow({ track, selected, isDefault, onSelect }: TrackRowProps) {
  const label = getEmbeddedSubtitleTrackLabel(track)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full flex items-center justify-between gap-3 rounded border px-3 py-2 text-left',
          'transition-colors',
          selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/40',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{label}</span>
            {track.forced && <Badge>forced</Badge>}
            {track.default && <Badge>default</Badge>}
            {isDefault && !track.forced && !track.default && <Badge>auto-pick</Badge>}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            Track {track.trackNumber} · {track.codecId.replace('S_TEXT/', '')}
          </div>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums shrink-0">
          {track.cues.length} cues
        </div>
      </button>
    </li>
  )
}

function ModeToggleButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded border px-2.5 py-1.5 text-left text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-secondary/40 text-muted-foreground',
      )}
    >
      <div className="font-medium text-foreground">{label}</div>
      <div className="pt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>
    </button>
  )
}

function Badge({ children }: { children: import('react').ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
      {children}
    </span>
  )
}
