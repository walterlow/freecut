import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react'
import { Layers, Trash2, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/app/state/editor'
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  renameCompoundClip,
  useCompositionsStore,
  useCompositionNavigationStore,
  type SubComposition,
  wouldCreateCompositionCycle,
} from '@/features/media-library/deps/timeline-stores'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache'
import { GRID_MIN_SIZE_PX, GRID_GAP_BY_SIZE } from './media-grid-constants'
import { CARD_GRID_BASE, CARD_LIST_BASE, CARD_PERF_STYLE } from './card-styles'
import { compoundClipThumbnailService } from '../services/compound-clip-thumbnail-service'

/**
 * Compositions section in the media library.
 * Displays all sub-compositions as reusable assets.
 * Hidden when no compositions exist.
 */
export function CompositionsSection() {
  const compositions = useCompositionsStore((s) => s.compositions)
  const compositionById = useCompositionsStore((s) => s.compositionById)
  const enterComposition = useCompositionNavigationStore((s) => s.enterComposition)
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId)

  const viewMode = useMediaLibraryStore((s) => s.viewMode)
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize)
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds)
  const isTranscriptionDialogOpen = useEditorStore((s) => s.transcriptionDialogDepth > 0)
  const selectedCompositionIdSet = useMemo(
    () => new Set(selectedCompositionIds),
    [selectedCompositionIds],
  )
  const [open, setOpen] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<SubComposition | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const compositionsRef = useRef(compositions)
  const editValueRef = useRef(editValue)
  const renameCancelledRef = useRef(false)
  const lastSelectedCompositionIdRef = useRef<string | null>(null)

  useEffect(() => {
    compositionsRef.current = compositions
  }, [compositions])

  useEffect(() => {
    editValueRef.current = editValue
  }, [editValue])

  const handleEnter = useCallback(
    (comp: SubComposition) => {
      enterComposition(comp.id, comp.name)
    },
    [enterComposition],
  )

  const handleDeleteRequest = useCallback((comp: SubComposition) => {
    setDeleteTarget(comp)
  }, [])

  const handleCompositionSelect = useCallback((compositionId: string, event?: React.MouseEvent) => {
    const currentCompositions = compositionsRef.current
    const mediaStore = useMediaLibraryStore.getState()

    if (event?.shiftKey && lastSelectedCompositionIdRef.current) {
      const lastIndex = currentCompositions.findIndex(
        (item) => item.id === lastSelectedCompositionIdRef.current,
      )
      const currentIndex = currentCompositions.findIndex((item) => item.id === compositionId)

      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex)
        const endIndex = Math.max(lastIndex, currentIndex)
        const rangeIds = currentCompositions.slice(startIndex, endIndex + 1).map((item) => item.id)

        if (event.ctrlKey || event.metaKey) {
          mediaStore.setSelection({
            mediaIds: mediaStore.selectedMediaIds,
            compositionIds: [...new Set([...mediaStore.selectedCompositionIds, ...rangeIds])],
          })
        } else {
          mediaStore.setSelection({ mediaIds: [], compositionIds: rangeIds })
        }
        return
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      mediaStore.toggleCompositionSelection(compositionId)
      lastSelectedCompositionIdRef.current = compositionId
      return
    }

    mediaStore.setSelection({ mediaIds: [], compositionIds: [compositionId] })
    lastSelectedCompositionIdRef.current = compositionId
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteCompoundClips([deleteTarget.id])
    const mediaStore = useMediaLibraryStore.getState()
    mediaStore.setSelection({
      mediaIds: mediaStore.selectedMediaIds,
      compositionIds: mediaStore.selectedCompositionIds.filter((id) => id !== deleteTarget.id),
    })
    setDeleteTarget(null)
  }, [deleteTarget])

  const handleStartRename = useCallback((comp: SubComposition) => {
    setEditingId(comp.id)
    setEditValue(comp.name)
  }, [])

  const handleCommitRename = useCallback((id: string) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setEditingId(null)
      return
    }
    const trimmed = editValueRef.current.trim()
    if (trimmed && trimmed !== useCompositionsStore.getState().getComposition(id)?.name) {
      renameCompoundClip(id, trimmed)
    }
    setEditingId(null)
  }, [])

  const handleCancelRename = useCallback(() => {
    renameCancelledRef.current = true
    setEditingId(null)
  }, [])

  const cardHandlersById = useMemo(
    () =>
      new Map(
        compositions.map((comp) => [
          comp.id,
          {
            onSelect: (event: React.MouseEvent) => handleCompositionSelect(comp.id, event),
            onEnter: () => handleEnter(comp),
            onDelete: () => handleDeleteRequest(comp),
            onStartRename: () => handleStartRename(comp),
          },
        ]),
      ),
    [compositions, handleCompositionSelect, handleDeleteRequest, handleEnter, handleStartRename],
  )

  const deleteImpact = deleteTarget
    ? getCompoundClipDeletionImpact([deleteTarget.id])
    : { rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 }

  if (compositions.length === 0) return null

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <Layers className="w-3 h-3 text-violet-400" />
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Compound Clips
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {compositions.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            'pt-1 pb-2',
            viewMode === 'grid'
              ? `grid ${GRID_GAP_BY_SIZE[mediaItemSize] ?? GRID_GAP_BY_SIZE[3]}`
              : 'space-y-1',
          )}
          style={
            viewMode === 'grid'
              ? {
                  gridTemplateColumns: `repeat(auto-fill, minmax(min(${GRID_MIN_SIZE_PX[mediaItemSize] ?? GRID_MIN_SIZE_PX[3]}px, 100%), 1fr))`,
                }
              : undefined
          }
        >
          {compositions.map((comp) => {
            const handlers = cardHandlersById.get(comp.id)
            if (!handlers) return null

            return (
              <CompositionCard
                key={comp.id}
                composition={comp}
                viewMode={viewMode}
                selected={selectedCompositionIdSet.has(comp.id)}
                isTranscriptionDialogOpen={isTranscriptionDialogOpen}
                dragDisabled={wouldCreateCompositionCycle({
                  parentCompositionId: activeCompositionId,
                  insertedCompositionId: comp.id,
                  compositionById,
                })}
                isEditing={editingId === comp.id}
                editValue={editValue}
                onEditValueChange={setEditValue}
                onSelect={handlers.onSelect}
                onEnter={handlers.onEnter}
                onDelete={handlers.onDelete}
                onStartRename={handlers.onStartRename}
                onCommitRename={handleCommitRename}
                onCancelRename={handleCancelRename}
              />
            )
          })}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete compound clip?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action
                  cannot be undone.
                </p>
                {deleteImpact.totalReferenceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <Trash2 className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">All remaining instances will be removed</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {deleteImpact.totalReferenceCount} compound clip instance
                        {deleteImpact.totalReferenceCount > 1 ? 's' : ''} across the timeline and
                        nested compound clips will also be deleted.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface CompositionCardProps {
  composition: SubComposition
  viewMode: 'grid' | 'list'
  selected: boolean
  isTranscriptionDialogOpen: boolean
  dragDisabled: boolean
  isEditing: boolean
  editValue: string
  onEditValueChange: (value: string) => void
  onSelect: (event: React.MouseEvent) => void
  onEnter: () => void
  onDelete: () => void
  onStartRename: () => void
  onCommitRename: (id: string) => void
  onCancelRename: () => void
}

const CompositionCard = memo(function CompositionCard({
  composition,
  viewMode,
  selected,
  isTranscriptionDialogOpen,
  dragDisabled,
  isEditing,
  editValue,
  onEditValueChange,
  onSelect,
  onEnter,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: CompositionCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [skimProgress, setSkimProgress] = useState<number | null>(null)
  const thisComposition = useCompositionsStore(
    useCallback((s) => s.compositionById[composition.id], [composition.id]),
  )
  const setCompoundClipSkimPreview = useEditorStore((s) => s.setCompoundClipSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    let mounted = true

    const loadThumbnail = async () => {
      const url = await compoundClipThumbnailService.getThumbnailBlobUrl(composition.id)
      if (mounted) {
        setThumbnailUrl(url)
      }
    }

    void loadThumbnail()

    return () => {
      mounted = false
      if (useEditorStore.getState().compoundClipSkimPreviewCompositionId === composition.id) {
        clearCompoundClipSkimPreview()
      }
    }
  }, [clearCompoundClipSkimPreview, composition.id, thisComposition])

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (dragDisabled) {
        e.preventDefault()
        return
      }
      const data = {
        type: 'composition' as const,
        compositionId: composition.id,
        name: composition.name,
        durationInFrames: composition.durationInFrames,
        width: composition.width,
        height: composition.height,
      }
      e.dataTransfer.setData('application/json', JSON.stringify(data))
      e.dataTransfer.effectAllowed = 'copy'
      setMediaDragData(data)
    },
    [composition, dragDisabled],
  )

  const handleDragEnd = useCallback(() => {
    clearMediaDragData()
  }, [])

  const handleDoubleClick = useCallback(() => {
    onEnter()
  }, [onEnter])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onCommitRename(composition.id)
      } else if (e.key === 'Escape') {
        onCancelRename()
      }
    },
    [composition.id, onCommitRename, onCancelRename],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return
      onSelect(e)
    },
    [isEditing, onSelect],
  )

  const canHoverPreview = composition.durationInFrames > 0 && !isTranscriptionDialogOpen

  const updateSkimPreview = useCallback(
    (clientX: number) => {
      const thumbnailContainer = thumbnailContainerRef.current
      if (!thumbnailContainer || !canHoverPreview) return

      const rect = thumbnailContainer.getBoundingClientRect()
      if (rect.width <= 0) return

      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const frame = Math.min(
        composition.durationInFrames - 1,
        Math.max(0, Math.round(progress * Math.max(0, composition.durationInFrames - 1))),
      )

      setSkimProgress(progress)
      setCompoundClipSkimPreview(composition.id, frame)
    },
    [canHoverPreview, composition.durationInFrames, composition.id, setCompoundClipSkimPreview],
  )

  const handleThumbnailPointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canHoverPreview || event.pointerType === 'touch') return
      updateSkimPreview(event.clientX)
    },
    [canHoverPreview, updateSkimPreview],
  )

  const handleThumbnailPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canHoverPreview || event.pointerType === 'touch') return
      updateSkimPreview(event.clientX)
    },
    [canHoverPreview, updateSkimPreview],
  )

  const handleThumbnailPointerLeave = useCallback(() => {
    if (!canHoverPreview) return
    setSkimProgress(null)
    clearCompoundClipSkimPreview()
  }, [canHoverPreview, clearCompoundClipSkimPreview])

  const itemCount = composition.items.length
  const fps = composition.fps || 30
  const durationSecs = composition.durationInFrames / fps
  const durationLabel =
    durationSecs < 60
      ? `${durationSecs.toFixed(1)}s`
      : `${Math.floor(durationSecs / 60)}:${String(Math.floor(durationSecs % 60)).padStart(2, '0')}`

  if (viewMode === 'grid') {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-composition-id={composition.id}
            draggable={!dragDisabled && !isEditing}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            style={CARD_PERF_STYLE}
            className={cn(
              CARD_GRID_BASE,
              dragDisabled
                ? 'opacity-50 cursor-not-allowed border-border'
                : cn(
                    'cursor-grab',
                    selected
                      ? 'border-violet-500 ring-2 ring-violet-500/20 shadow-lg shadow-violet-500/10'
                      : 'border-border hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10',
                  ),
            )}
          >
            <div
              ref={thumbnailContainerRef}
              className="flex-1 bg-secondary relative overflow-hidden min-h-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30"
              onPointerEnter={handleThumbnailPointerEnter}
              onPointerMove={handleThumbnailPointerMove}
              onPointerLeave={handleThumbnailPointerLeave}
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={composition.name}
                  className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <Layers className="w-8 h-8 text-violet-400/70" />
              )}

              <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
                <div className="p-0.5 rounded bg-violet-600/90 text-white">
                  <Layers className="w-2.5 h-2.5" />
                </div>
                <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                  {durationLabel}
                </div>
              </div>
              {skimProgress !== null && (
                <div
                  className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
                  style={{ left: `${skimProgress * 100}%` }}
                />
              )}
            </div>

            <div className="px-1.5 py-1 bg-panel-bg/50 flex-shrink-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => onEditValueChange(e.target.value)}
                      onBlur={() => onCommitRename(composition.id)}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-transparent border border-primary rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                    />
                  ) : (
                    <h3 className="text-[10px] font-medium text-foreground truncate group-hover:text-violet-400 transition-colors">
                      {composition.name}
                    </h3>
                  )}
                </div>
              </div>
            </div>

            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
            <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={onEnter}>Enter Compound Clip</ContextMenuItem>
          <ContextMenuItem onClick={onStartRename}>Rename</ContextMenuItem>
          <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-composition-id={composition.id}
          draggable={!dragDisabled && !isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          style={CARD_PERF_STYLE}
          className={cn(
            CARD_LIST_BASE,
            dragDisabled
              ? 'opacity-50 cursor-not-allowed border-border'
              : cn(
                  'cursor-grab',
                  selected
                    ? 'border-violet-500 ring-1 ring-violet-500/20'
                    : 'border-border hover:border-violet-500/50',
                ),
          )}
        >
          <div
            ref={thumbnailContainerRef}
            className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30 relative"
            onPointerEnter={handleThumbnailPointerEnter}
            onPointerMove={handleThumbnailPointerMove}
            onPointerLeave={handleThumbnailPointerLeave}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={composition.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <Layers className="w-5 h-5 text-violet-400" />
            )}
            {skimProgress !== null && (
              <div
                className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
                style={{ left: `${skimProgress * 100}%` }}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onCommitRename(composition.id)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border border-primary rounded px-1 py-0.5 text-xs text-foreground outline-none"
              />
            ) : (
              <h3 className="text-xs font-medium text-foreground truncate">{composition.name}</h3>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <div className="p-0.5 rounded bg-violet-600/90 text-white flex-shrink-0">
                <Layers className="w-2.5 h-2.5" />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {durationLabel} &middot; {itemCount} item{itemCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={onEnter}>Enter Compound Clip</ContextMenuItem>
        <ContextMenuItem onClick={onStartRename}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
