import {
  Info,
  Video,
  FileAudio,
  Image as ImageIcon,
  Film,
  Clock,
  Maximize2,
  HardDrive,
  FileType,
  Loader2,
  FileText,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { MediaMetadata, MediaTranscript } from '@/types/storage'
import { getMediaType, formatDuration } from '../utils/validation'
import { formatBytes } from '@/shared/utils/format-utils'
import { mediaTranscriptionService } from '../services/media-transcription-service'
import { getMediaTranscriptionModelLabel } from '../transcription/registry'

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface MediaInfoPopoverProps {
  media: MediaMetadata
  /** Tailwind classes for the trigger button */
  triggerClassName?: string
  /** Called when user clicks a caption timestamp to open source monitor at that time */
  onSeekToCaption?: (timeSec: number) => void
}

export function MediaInfoPopover({
  media,
  triggerClassName,
  onSeekToCaption,
}: MediaInfoPopoverProps) {
  const [open, setOpen] = useState(false)
  const [transcript, setTranscript] = useState<MediaTranscript | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const mediaType = getMediaType(media.mimeType)
  const typeLabel = mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Image'
  const isTranscribable = mediaType === 'video' || mediaType === 'audio'

  const rows: Array<{ icon: React.ReactNode; label: string; value: string }> = []

  rows.push({
    icon: <FileType className="w-3 h-3" />,
    label: 'Type',
    value: `${typeLabel} (${media.mimeType.split('/')[1]})`,
  })

  if ((mediaType === 'video' || mediaType === 'audio') && media.duration > 0) {
    rows.push({
      icon: <Clock className="w-3 h-3" />,
      label: 'Duration',
      value: formatDuration(media.duration),
    })
  }

  if ((mediaType === 'video' || mediaType === 'image') && media.width > 0 && media.height > 0) {
    rows.push({
      icon: <Maximize2 className="w-3 h-3" />,
      label: 'Dimensions',
      value: `${media.width} × ${media.height}`,
    })
  }

  if (media.codec && media.codec !== 'importing...') {
    let codecStr = media.codec
    if (media.audioCodec) codecStr += ` / ${media.audioCodec}`
    rows.push({ icon: <Film className="w-3 h-3" />, label: 'Codec', value: codecStr })
  }

  rows.push({
    icon: <HardDrive className="w-3 h-3" />,
    label: 'Size',
    value: formatBytes(media.fileSize),
  })

  if (mediaType === 'video' && media.fps > 0) {
    rows.push({
      icon: <Film className="w-3 h-3" />,
      label: 'Frame Rate',
      value: `${media.fps.toFixed(2)} fps`,
    })
  }

  useEffect(() => {
    if (!open || !isTranscribable) {
      return
    }

    let cancelled = false
    setTranscriptLoading(true)

    void mediaTranscriptionService
      .getTranscript(media.id)
      .then((loadedTranscript) => {
        if (!cancelled) {
          setTranscript(loadedTranscript ?? null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTranscriptLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isTranscribable, media.id, open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={
            triggerClassName ??
            'p-0.5 rounded bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors'
          }
          title="Media info"
        >
          <Info className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-56 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/50">
          {mediaType === 'video' && <Video className="w-3.5 h-3.5 text-primary" />}
          {mediaType === 'audio' && <FileAudio className="w-3.5 h-3.5 text-green-500" />}
          {mediaType === 'image' && <ImageIcon className="w-3.5 h-3.5 text-blue-500" />}
          <span className="text-[11px] font-medium text-foreground truncate">{media.fileName}</span>
        </div>

        {/* Info rows */}
        <div className="p-3 space-y-1">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground flex-shrink-0">{row.icon}</span>
              <span className="text-muted-foreground w-16 flex-shrink-0">{row.label}</span>
              <span className="text-foreground truncate">{row.value}</span>
            </div>
          ))}
        </div>

        {(transcriptLoading || transcript) && (
          <div className="border-t border-border/50">
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <FileText className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-muted-foreground">
                {transcript ? `Transcript (${transcript.segments.length})` : 'Transcript'}
              </span>
              {transcript && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {getMediaTranscriptionModelLabel(transcript.model)}
                </span>
              )}
            </div>
            {transcriptLoading ? (
              <div className="px-3 pb-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading transcript...
              </div>
            ) : transcript ? (
              <div className="px-3 pb-2 space-y-2">
                <p className="text-[10px] leading-snug text-foreground/85 line-clamp-3">
                  {transcript.text}
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {transcript.segments.map((segment, i) => (
                    <div
                      key={`${segment.start}-${segment.end}-${i}`}
                      className="flex gap-2 text-[10px]"
                    >
                      <button
                        type="button"
                        className="text-primary/80 hover:text-primary font-mono flex-shrink-0 w-10 text-right cursor-pointer hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSeekToCaption?.(segment.start)
                        }}
                        title="Open in source monitor"
                      >
                        {formatTimestamp(segment.start)}
                      </button>
                      <span className="text-foreground leading-snug">{segment.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
