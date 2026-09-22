import { MousePointer2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { PropertyRow } from '../components'
import type { SharedShapeValue } from './shape-section-shared-values'

interface ShapePathControlsProps {
  /** Id of the single selected path shape; null hides every path control. */
  pathItemId: string | null
  isEditingPath: boolean
  isMaskOnly: boolean
  showPathClosure: boolean
  pathClosed: SharedShapeValue<boolean>
  selectedVertexIndex: number | null
  startEditing: (itemId: string) => void
  stopEditing: () => void
  onReversePath: () => void
  onPathClosedChange: (closed: boolean) => void
  onSetFirstVertex: () => void
}

/** Editing entry point, vertex order, closure, and start-vertex controls for a bezier path shape. */
export function ShapePathControls({
  pathItemId,
  isEditingPath,
  isMaskOnly,
  showPathClosure,
  pathClosed,
  selectedVertexIndex,
  startEditing,
  stopEditing,
  onReversePath,
  onPathClosedChange,
  onSetFirstVertex,
}: ShapePathControlsProps) {
  const { t } = useTranslation()

  return (
    <>
    {pathItemId && (
      <>
        <PropertyRow label={t('editor.shapeSection.path')}>
          <div className="flex items-center gap-2 w-full">
            <Button
              variant={isEditingPath ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                if (isEditingPath) {
                  stopEditing()
                } else {
                  startEditing(pathItemId)
                }
              }}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
              {isEditingPath ? t('common.done') : t('editor.shapeSection.editPath')}
            </Button>
            {!isMaskOnly && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onReversePath}
              >
                {t('editor.shapeSection.reversePath')}
              </Button>
            )}
          </div>
        </PropertyRow>
        {showPathClosure && (
          <>
            <PropertyRow label={t('editor.shapeSection.pathClosure')}>
              <div className="grid w-full grid-cols-2 gap-1">
                <Button
                  variant={pathClosed === false ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onPathClosedChange(false)}
                >
                  {t('editor.shapeSection.openPath')}
                </Button>
                <Button
                  variant={pathClosed === true ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onPathClosedChange(true)}
                >
                  {t('editor.shapeSection.closedPath')}
                </Button>
              </div>
            </PropertyRow>
            <p className="px-1 pb-1 text-[10px] leading-4 text-muted-foreground">
              {t(
                pathClosed === false
                  ? 'editor.shapeSection.openPathHint'
                  : 'editor.shapeSection.closedPathHint',
              )}
            </p>
          </>
        )}
        {isEditingPath &&
          !isMaskOnly &&
          pathClosed === true && (
            <PropertyRow label={t('editor.shapeSection.firstVertex')}>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={selectedVertexIndex === null}
                onClick={onSetFirstVertex}
              >
                {t('editor.shapeSection.setSelectedFirst')}
              </Button>
            </PropertyRow>
          )}
      </>
    )}
    </>
  )
}
