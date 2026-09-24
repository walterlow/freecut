import type { TFunction } from 'i18next'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS } from '@/features/editor/services/supertonic-tts-service'
import type { StoredTtsEngine } from '@/shared/utils/tts-settings'
import { insertTextAtCursor } from '../utils/tts-ui-helpers'

interface TtsTextPanelProps {
  engine: StoredTtsEngine
  text: string
  onTextChange: (text: string) => void
  busy: boolean
  t: TFunction
}

/** Script textarea, plus the Supertonic expressive-tag shortcuts. */
export function TtsTextPanel({ engine, text, onTextChange, busy, t }: TtsTextPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div className="space-y-2">
      <Label htmlFor="tts-dialog-text">{t('editor.tts.text')}</Label>
      <Textarea
        ref={textareaRef}
        id="tts-dialog-text"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={t('editor.tts.textPlaceholder')}
        className="min-h-28 resize-y bg-secondary/30 text-sm"
        disabled={busy}
      />
      {engine === 'supertonic' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {t('editor.tts.expressiveTags', { defaultValue: 'Expressive tags' })}
          </span>
          {SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS.map((tag) => (
            <Button
              key={tag.value}
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                insertTextAtCursor({
                  input: textareaRef.current,
                  insertText: tag.value,
                  setText: onTextChange,
                  text,
                })
              }
              disabled={busy}
            >
              {tag.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
