import { memo } from 'react'
import { ListFilter, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface AnimationPresetToolbarProps {
  /** Whether the selection carries anything capturable (gates the save button). */
  canCapture: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  compatibleOnly: boolean
  onToggleCompatibleOnly: () => void
  onOpenSaveDialog: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/** Library header (title + save) and the search / compatible-only filter row. */
export const AnimationPresetToolbar = memo(function AnimationPresetToolbar({
  canCapture,
  searchQuery,
  onSearchQueryChange,
  compatibleOnly,
  onToggleCompatibleOnly,
  onOpenSaveDialog,
  t,
}: AnimationPresetToolbarProps) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('editor.animatePresets.title')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                disabled={!canCapture}
                onClick={onOpenSaveDialog}
              >
                <Plus className="h-3 w-3" />
                {t('editor.animatePresets.saveButtonLong')}
              </Button>
            </span>
          </TooltipTrigger>
          {!canCapture && (
            <TooltipContent>{t('editor.animatePresets.noAnimationToSave')}</TooltipContent>
          )}
        </Tooltip>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border/70 p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            name="animation-preset-search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t('editor.animatePresets.searchPlaceholder')}
            aria-label={t('editor.animatePresets.searchPlaceholder')}
            autoComplete="off"
            className="h-7 pl-7 pr-7 text-[11px]"
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              aria-label={t('editor.animatePresets.clearSearch')}
              className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onSearchQueryChange('')}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={compatibleOnly ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-[10px]"
          aria-pressed={compatibleOnly}
          title={t('editor.animatePresets.compatibleOnlyHint')}
          onClick={onToggleCompatibleOnly}
        >
          <ListFilter className="h-3 w-3" />
          {t('editor.animatePresets.compatibleOnly')}
        </Button>
      </div>
    </>
  )
})
