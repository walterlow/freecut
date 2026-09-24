import type { StoredTtsEngine } from '@/shared/utils/tts-settings'
import { resolveTtsUnsupportedMessage, type TtsTranslate } from '../utils/tts-generate-options'

interface TtsUnsupportedNoticeProps {
  engine: StoredTtsEngine
  t: TtsTranslate
}

/** Amber banner shown when the selected engine cannot run in this browser. */
export function TtsUnsupportedNotice({ engine, t }: TtsUnsupportedNoticeProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
      {resolveTtsUnsupportedMessage(engine, t)}
    </div>
  )
}

interface TtsProgressNoticeProps {
  progress: string
}

export function TtsProgressNotice({ progress }: TtsProgressNoticeProps) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
      {progress}
    </div>
  )
}

interface TtsErrorNoticeProps {
  error: string
}

export function TtsErrorNotice({ error }: TtsErrorNoticeProps) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      {error}
    </div>
  )
}
