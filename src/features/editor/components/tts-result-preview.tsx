import type { TFunction } from 'i18next'
import { memo, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Pause, Play } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { useMediaPlaybackControls } from '@/shared/media/use-media-playback-controls'
import { i18n } from '@/i18n'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const RESULT_CARD_CLASS = {
  inserted: 'border-emerald-500/25 bg-emerald-500/5',
  pending: 'border-border bg-secondary/20',
} as const

// --- Mini audio player for previewing the result ---

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  isSeekingRef.current = isSeeking

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime)
    }
    const onLoaded = () => setDuration(el.duration)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
      el.currentTime = 0
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('ended', onEnded)

    return () => {
      el.pause()
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const { togglePlay, seekToPercent } = useMediaPlaybackControls(audioRef, duration, setCurrentTime)

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? i18n.t('preview.player.pause') : i18n.t('preview.player.play')}
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true)
          seekToPercent(values)
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label={i18n.t('editor.tts.seek')}
      />
      <span className="shrink-0 select-none font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  )
})

interface TtsResultPreviewProps {
  result: { voice: string; model: string; duration: number; objectUrl: string }
  inserted: boolean
  t: TFunction
}

/** Generated-clip card: metadata line, preview player and the linked badge. */
export function TtsResultPreview({ result, inserted, t }: TtsResultPreviewProps) {
  const cardClass = inserted ? RESULT_CARD_CLASS.inserted : RESULT_CARD_CLASS.pending

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${cardClass}`}>
      <p className="text-[11px] text-muted-foreground">
        {result.voice} / {result.model} /{' '}
        {result.duration > 0 ? `${result.duration.toFixed(1)}s` : '-'}
      </p>
      <MiniAudioPlayer src={result.objectUrl} />

      {inserted && (
        <span className="flex items-center gap-1 text-[11px] text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          {t('editor.tts.insertedAndLinked')}
        </span>
      )}
    </div>
  )
}
