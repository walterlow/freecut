import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Move } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EditorPanelPosition } from '@/config/editor-workspaces'
import { useMaskEditorStore } from '@/features/editor/deps/preview'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'

const POSITIONS: readonly EditorPanelPosition[] = ['bottom', 'right', 'top', 'left']
// Drop targets follow the visual grid so Tab moves top-to-bottom, left-to-right.
const GRID_POSITIONS: readonly EditorPanelPosition[] = ['top', 'left', 'right', 'bottom']
const DRAG_TYPE = 'application/x-freecut-layout-panel'

export function LayoutMenu() {
  const { t } = useTranslation()
  const workspace = useEditorStore((s) => s.workspace)
  const position = useEditorStore((s) => s.panelPosition)
  const setPosition = useEditorStore((s) => s.setPanelPosition)
  const setEditing = useEditorStore((s) => s.setLayoutEditing)
  const reset = useEditorStore((s) => s.resetPanelLayout)
  const maskEditing = useMaskEditorStore((s) => s.isEditing)
  const surface = t(workspace === 'color' ? 'toolbar.layout.grading' : 'toolbar.layout.timeline')
  // Radix restores focus to the trigger on close, which would steal it from the layout editor.
  const openingEditorRef = useRef(false)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={maskEditing}
          aria-label={t('toolbar.layout.label')}
          data-layout-trigger
          data-tooltip={t('toolbar.layout.label')}
          data-tooltip-side="bottom"
        >
          <LayoutDashboard className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!openingEditorRef.current) return
          openingEditorRef.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuLabel>{t('toolbar.layout.position', { surface })}</DropdownMenuLabel>
        {POSITIONS.map((item) => (
          <DropdownMenuCheckboxItem
            key={item}
            checked={position === item}
            onSelect={() => setPosition(item)}
          >
            {t(`toolbar.layout.${item}`)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            openingEditorRef.current = true
            setEditing(true)
          }}
        >
          {t('toolbar.layout.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={reset}>{t('toolbar.layout.reset')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A temporary, keyboard-operable drop map; the editor surfaces remain unobstructed outside edit mode. */
export function LayoutEditor() {
  const { t } = useTranslation()
  const editing = useEditorStore((s) => s.layoutEditing)
  const setEditing = useEditorStore((s) => s.setLayoutEditing)
  const position = useEditorStore((s) => s.panelPosition)
  const setPosition = useEditorStore((s) => s.setPanelPosition)
  const workspace = useEditorStore((s) => s.workspace)
  const surface = t(workspace === 'color' ? 'toolbar.layout.grading' : 'toolbar.layout.timeline')
  const overlayRef = useRef<HTMLDivElement>(null)
  const activePositionRef = useRef<HTMLButtonElement>(null)
  const [dropTarget, setDropTarget] = useState<EditorPanelPosition | null>(null)

  useEffect(() => {
    if (!editing) return
    // Window capture runs before the editor's document-level capture hotkeys, so
    // Space/Delete/... never reach the surfaces hidden behind the overlay.
    // Stopping propagation keeps default actions, so buttons still activate.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      const withinOverlay =
        target === document.body ||
        (target instanceof Node && !!overlayRef.current?.contains(target))
      if (event.key === 'Escape' && event.type === 'keydown') {
        event.stopPropagation()
        setEditing(false)
        return
      }
      if (withinOverlay) event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    const focusFrame = requestAnimationFrame(() => activePositionRef.current?.focus())
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      document.querySelector<HTMLButtonElement>('[data-layout-trigger]')?.focus()
    }
  }, [editing, setEditing])

  if (!editing) return null
  return (
    <div
      ref={overlayRef}
      // Focusable so clicking empty overlay space keeps keys inside the editor.
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/85 p-4 outline-none"
      role="region"
      aria-label={t('toolbar.layout.edit')}
    >
      <div className="text-center">
        <p className="text-sm font-semibold">{t('toolbar.layout.edit')}</p>
        <p className="text-xs text-muted-foreground">
          {t('toolbar.layout.instructions', { surface })}
        </p>
      </div>
      <div className="grid w-full max-w-md grid-cols-3 grid-rows-3 gap-1 text-center">
        {GRID_POSITIONS.map((item) => (
          <button
            key={item}
            ref={position === item ? activePositionRef : undefined}
            type="button"
            aria-pressed={position === item}
            onClick={() => setPosition(item)}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dropTarget !== item) setDropTarget(item)
            }}
            onDragLeave={() => setDropTarget((current) => (current === item ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              setDropTarget(null)
              if (event.dataTransfer.getData(DRAG_TYPE) === 'surface') setPosition(item)
            }}
            className={cn(
              'min-h-12 rounded border border-dashed p-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              position === item && 'border-primary bg-primary/10',
              dropTarget === item && 'border-solid border-primary bg-primary/20',
              item === 'top' && 'col-start-2 row-start-1',
              item === 'left' && 'col-start-1 row-start-2',
              item === 'right' && 'col-start-3 row-start-2',
              item === 'bottom' && 'col-start-2 row-start-3',
            )}
          >
            {t(`toolbar.layout.${item}`)}
          </button>
        ))}
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, 'surface')
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDropTarget(null)}
          className="col-start-2 row-start-2 flex min-h-16 cursor-grab items-center justify-center gap-1 rounded border bg-muted p-2 text-xs font-medium active:cursor-grabbing"
        >
          <Move className="h-4 w-4" />
          {surface}
        </div>
      </div>
      <Button size="sm" onClick={() => setEditing(false)}>
        {t('common.done')}
      </Button>
    </div>
  )
}
