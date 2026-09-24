import type { TFunction } from 'i18next'
import { CheckCircle2, Loader2, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TtsGenerateButtonContentProps {
  isGenerating: boolean
  hasResult: boolean
  t: TFunction
}

function TtsGenerateButtonContent({ isGenerating, hasResult, t }: TtsGenerateButtonContentProps) {
  return (
    <>
      {isGenerating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <WandSparkles className="h-3.5 w-3.5" />
      )}
      {isGenerating
        ? t('editor.tts.generating')
        : hasResult
          ? t('editor.tts.regenerate')
          : t('editor.tts.generate')}
    </>
  )
}

interface TtsGenerateButtonProps {
  isGenerating: boolean
  hasResult: boolean
  inserted: boolean
  canGenerate: boolean
  onGenerate: () => void
  t: TFunction
}

function TtsGenerateButton({
  isGenerating,
  hasResult,
  inserted,
  canGenerate,
  onGenerate,
  t,
}: TtsGenerateButtonProps) {
  const variant = hasResult && !inserted ? 'secondary' : 'default'

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onGenerate}
      disabled={!canGenerate}
      className="h-8 gap-1.5"
    >
      <TtsGenerateButtonContent isGenerating={isGenerating} hasResult={hasResult} t={t} />
    </Button>
  )
}

interface TtsInsertButtonProps {
  isInserting: boolean
  disabled: boolean
  onInsert: () => void
  t: TFunction
}

function TtsInsertButton({ isInserting, disabled, onInsert, t }: TtsInsertButtonProps) {
  return (
    <Button size="sm" onClick={onInsert} disabled={disabled} className="h-8 gap-1.5">
      {isInserting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      {isInserting ? t('editor.tts.inserting') : t('editor.tts.insertAndLink')}
    </Button>
  )
}

interface TtsDialogActionsProps {
  isGenerating: boolean
  isInserting: boolean
  hasResult: boolean
  inserted: boolean
  canGenerate: boolean
  onGenerate: () => void
  onInsert: () => void
  t: TFunction
}

/** Footer actions: synthesize (or re-synthesize) and insert-and-link. */
export function TtsDialogActions({
  isGenerating,
  isInserting,
  hasResult,
  inserted,
  canGenerate,
  onGenerate,
  onInsert,
  t,
}: TtsDialogActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <TtsGenerateButton
        isGenerating={isGenerating}
        hasResult={hasResult}
        inserted={inserted}
        canGenerate={canGenerate}
        onGenerate={onGenerate}
        t={t}
      />

      {hasResult && !inserted && (
        <TtsInsertButton
          isInserting={isInserting}
          disabled={isInserting || isGenerating}
          onInsert={onInsert}
          t={t}
        />
      )}
    </div>
  )
}
