import type { TFunction } from 'i18next'
import { Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MOSS_TTS_SUPPORTED_LANGUAGES } from '@/features/editor/services/moss-tts-service'
import {
  SUPERTONIC_TTS_LANGUAGE_OPTIONS,
  SUPERTONIC_TTS_SUPPORTED_LANGUAGES,
  type SupertonicTtsLanguageSelection,
} from '@/features/editor/services/supertonic-tts-service'
import { i18n } from '@/i18n'
import type { StoredTtsEngine } from '@/shared/utils/tts-settings'
import { getLanguageDisplayName } from '../utils/tts-ui-helpers'

interface TtsEngineVoiceFieldsProps {
  engine: StoredTtsEngine
  onEngineChange: (engine: StoredTtsEngine) => void
  voice: string
  voiceOptions: readonly { value: string; label: string }[]
  onVoiceChange: (voice: string) => void
  language: SupertonicTtsLanguageSelection
  onLanguageChange: (language: SupertonicTtsLanguageSelection) => void
  busy: boolean
  t: TFunction
}

/** Engine picker with its support popover, plus the voice and language pickers. */
export function TtsEngineVoiceFields({
  engine,
  onEngineChange,
  voice,
  voiceOptions,
  onVoiceChange,
  language,
  onLanguageChange,
  busy,
  t,
}: TtsEngineVoiceFieldsProps) {
  const mossLanguagesLabel = MOSS_TTS_SUPPORTED_LANGUAGES.join(', ')
  const supertonicLanguagesLabel = SUPERTONIC_TTS_SUPPORTED_LANGUAGES.join(', ')

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label>{t('editor.tts.engine')}</Label>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t('editor.tts.engineSupportDetails')}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-2 p-3">
              <div className="space-y-1">
                <p className="text-xs font-medium">Kokoro</p>
                <p className="text-[11px] text-muted-foreground">
                  {t('editor.tts.kokoroDescription')}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">MOSS Nano</p>
                <p className="text-[11px] text-muted-foreground">
                  {t('editor.tts.supportedLanguages', { languages: mossLanguagesLabel })}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">Supertonic 3</p>
                <p className="text-[11px] text-muted-foreground">
                  {t('editor.tts.supportedLanguages', { languages: supertonicLanguagesLabel })}
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Select
          value={engine}
          onValueChange={(value) => onEngineChange(value as StoredTtsEngine)}
          disabled={busy}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="kokoro" className="text-xs">
              {t('editor.tts.kokoroOption')}
            </SelectItem>
            <SelectItem value="moss" className="text-xs">
              {t('editor.tts.mossOption')}
            </SelectItem>
            <SelectItem value="supertonic" className="text-xs">
              {t('editor.tts.supertonicOption', {
                defaultValue: 'Supertonic 3 (31 languages, local ONNX)',
              })}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <Label>{t('editor.tts.voice')}</Label>
          <Select value={voice} onValueChange={onVoiceChange} disabled={busy}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {voiceOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {engine === 'supertonic' && (
          <div className="space-y-1.5">
            <Label>{t('editor.tts.language', { defaultValue: 'Language' })}</Label>
            <Select
              value={language}
              onValueChange={(value) => onLanguageChange(value as SupertonicTtsLanguageSelection)}
              disabled={busy}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {SUPERTONIC_TTS_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {getLanguageDisplayName(
                      option.value,
                      option.label,
                      i18n.language,
                      t('editor.tts.autoDetectLanguage', { defaultValue: 'Auto detect' }),
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}
