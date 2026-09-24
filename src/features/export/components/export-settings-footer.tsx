/**
 * Footer actions for the settings step: cancel, the render-queue menu that adds
 * whole/segment jobs, and the export button. The queue handlers live in the
 * dialog — this only places the buttons that call them.
 */

import { useTranslation } from 'react-i18next'
import { ChevronDown, ListPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ExportMode } from '@/types/export'

/** Chunk lengths the queue menu offers for splitting a sequence. */
const SPLIT_CHUNK_SECONDS = [10, 30, 60]

export interface ExportSettingsFooterProps {
  mode: ExportMode
  /** The render path isn't ready (probe running, blocked, unsupported…) — both actions stay off. */
  actionsDisabled: boolean
  onClose: () => void
  onExport: () => void
  onAddCurrentRange: () => void
  onAddMarkerSegments: () => void
  onSplitChunks: (seconds: number) => void
}

export function ExportSettingsFooter({
  mode,
  actionsDisabled,
  onClose,
  onExport,
  onAddCurrentRange,
  onAddMarkerSegments,
  onSplitChunks,
}: ExportSettingsFooterProps) {
  const { t } = useTranslation()

  return (
    <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-1.5" disabled={actionsDisabled}>
            <ListPlus className="h-4 w-4" />
            {t('export.renderQueue.addToQueue')}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onAddCurrentRange}>
            {t('export.renderQueue.addCurrentRange')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('export.renderQueue.segmentsHeading')}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={onAddMarkerSegments}>
            {t('export.renderQueue.perMarker')}
          </DropdownMenuItem>
          {SPLIT_CHUNK_SECONDS.map((seconds) => (
            <DropdownMenuItem key={seconds} onClick={() => onSplitChunks(seconds)}>
              {t('export.renderQueue.splitChunks', { seconds })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button onClick={onExport} disabled={actionsDisabled}>
        {mode === 'audio' ? t('export.settings.exportAudio') : t('export.settings.exportVideo')}
      </Button>
    </div>
  )
}
