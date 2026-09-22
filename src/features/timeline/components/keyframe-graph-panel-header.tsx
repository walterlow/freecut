import { Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import type { KeyframeEditorMode } from './use-keyframe-graph-panel-view-state'

export interface KeyframeGraphPanelHeaderProps {
  surface: 'default' | 'edit' | 'motion'
  selectedItemForEditor: { label?: string | null; type: string; id: string } | null
  effectiveEditorMode: KeyframeEditorMode
  splitView: boolean
  setEditorMode: (mode: KeyframeEditorMode) => void
  isFocusMode: boolean
  onFocusModeChange?: (isFocusMode: boolean) => void
  showCloseButton: boolean
  onClose: () => void
}

export function KeyframeGraphPanelHeader({
  surface,
  selectedItemForEditor,
  effectiveEditorMode,
  splitView,
  setEditorMode,
  isFocusMode,
  onFocusModeChange,
  showCloseButton,
  onClose,
}: KeyframeGraphPanelHeaderProps) {
  const { t } = useTranslation()

  if (surface === 'edit') return null
  return (
    <div className="h-8 flex items-center justify-between px-3 bg-secondary/30 border-b border-border">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {surface === 'motion'
            ? t('editor.compose.motionCurves')
            : t('timeline.keyframeEditor.title')}
          {selectedItemForEditor && (
            <span className="ml-2 text-foreground">
              - {selectedItemForEditor.label || selectedItemForEditor.type}
              <span className="ml-1 text-muted-foreground">
                ({selectedItemForEditor.id.slice(0, 8)})
              </span>
            </span>
          )}
        </span>
      </div>

      <div
        className={cn(
          'flex items-center gap-0.5',
          surface === 'default' && 'rounded-md border border-border/60 bg-background/50 p-0.5',
        )}
        role={surface === 'default' ? 'tablist' : undefined}
        aria-label={
          surface === 'motion'
            ? t('editor.compose.motionCurves')
            : t('timeline.keyframeEditor.title')
        }
      >
        {surface === 'default' && (
          <>
            <Button
              variant={effectiveEditorMode === 'dopesheet' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[11px]"
              role="tab"
              aria-selected={effectiveEditorMode === 'dopesheet'}
              title={t('timeline.keyframeEditor.legend.sheetMode')}
              aria-label={t('timeline.keyframeEditor.legend.sheetMode')}
              onClick={(e) => {
                e.stopPropagation()
                setEditorMode('dopesheet')
              }}
            >
              {t('timeline.keyframeEditor.sheet')}
            </Button>
            <Button
              variant={effectiveEditorMode === 'graph' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[11px]"
              role="tab"
              aria-selected={effectiveEditorMode === 'graph'}
              title={t('timeline.keyframeEditor.legend.graphMode')}
              aria-label={t('timeline.keyframeEditor.legend.graphMode')}
              onClick={(e) => {
                e.stopPropagation()
                setEditorMode('graph')
              }}
            >
              {t('timeline.keyframeEditor.graph')}
            </Button>
            {splitView && (
              <Button
                variant={effectiveEditorMode === 'split' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[11px]"
                role="tab"
                aria-selected={effectiveEditorMode === 'split'}
                title={t('timeline.keyframeEditor.split')}
                aria-label={t('timeline.keyframeEditor.split')}
                onClick={(e) => {
                  e.stopPropagation()
                  setEditorMode('split')
                }}
              >
                {t('timeline.keyframeEditor.split')}
              </Button>
            )}
          </>
        )}
        {onFocusModeChange && (
          <Button
            variant={isFocusMode ? 'secondary' : 'ghost'}
            size="icon"
            className="ml-0.5 h-6 w-6 p-0"
            title={t(
              isFocusMode
                ? 'timeline.keyframeEditor.exitFocusMode'
                : 'timeline.keyframeEditor.enterFocusMode',
            )}
            aria-label={t(
              isFocusMode
                ? 'timeline.keyframeEditor.exitFocusMode'
                : 'timeline.keyframeEditor.enterFocusMode',
            )}
            aria-pressed={isFocusMode}
            onClick={(event) => {
              event.stopPropagation()
              onFocusModeChange(!isFocusMode)
            }}
          >
            {isFocusMode ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
        )}
        {showCloseButton && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            aria-label={t('common.close')}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
