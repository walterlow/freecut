import { useState, useCallback, useRef, useEffect } from 'react';
import { Layers, Trash2, ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/shared/ui/cn';
import {
  useCompositionsStore,
  useCompositionNavigationStore,
  useItemsStore,
  type SubComposition,
} from '@/features/media-library/deps/timeline-stores';
import { removeItemsFromItemsActions as removeItems } from '@/features/media-library/deps/timeline-actions';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache';

/**
 * Compositions section in the media library.
 * Displays all sub-compositions as reusable assets.
 * Hidden when no compositions exist.
 */
export function CompositionsSection() {
  const compositions = useCompositionsStore((s) => s.compositions);
  const removeComposition = useCompositionsStore((s) => s.removeComposition);
  const updateComposition = useCompositionsStore((s) => s.updateComposition);
  const enterComposition = useCompositionNavigationStore((s) => s.enterComposition);
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId);

  const viewMode = useMediaLibraryStore((s) => s.viewMode);
  const [open, setOpen] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SubComposition | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const renameCancelledRef = useRef(false);

  if (compositions.length === 0) return null;

  const handleEnter = (comp: SubComposition) => {
    enterComposition(comp.id, comp.name);
  };

  const handleDeleteRequest = (comp: SubComposition) => {
    setDeleteTarget(comp);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const items = useItemsStore.getState().items;
    const refsOnTimeline = items.filter(
      (i) => i.type === 'composition' && i.compositionId === deleteTarget.id
    );
    if (refsOnTimeline.length > 0) {
      removeItems(refsOnTimeline.map((i) => i.id));
    }
    removeComposition(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleStartRename = (comp: SubComposition) => {
    setEditingId(comp.id);
    setEditValue(comp.name);
  };

  const handleCommitRename = (id: string) => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setEditingId(null);
      return;
    }
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== useCompositionsStore.getState().getComposition(id)?.name) {
      updateComposition(id, { name: trimmed });
    }
    setEditingId(null);
  };

  const refsOnTimeline = deleteTarget
    ? useItemsStore.getState().items.filter(
        (i) => i.type === 'composition' && i.compositionId === deleteTarget.id
      )
    : [];

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
          <Layers className="w-3 h-3 text-violet-400" />
          <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            Compositions
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {compositions.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className={cn(
          'pt-1 pb-2',
          viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 gap-4' : 'space-y-2'
        )}>
          {compositions.map((comp) => (
            <CompositionCard
              key={comp.id}
              composition={comp}
              viewMode={viewMode}
              isInsideSubComp={activeCompositionId !== null}
              isEditing={editingId === comp.id}
              editValue={editValue}
              onEditValueChange={setEditValue}
              onEnter={handleEnter}
              onDelete={handleDeleteRequest}
              onStartRename={handleStartRename}
              onCommitRename={handleCommitRename}
              onCancelRename={() => {
                renameCancelledRef.current = true;
                setEditingId(null);
              }}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete composition?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
                  This action cannot be undone.
                </p>
                {refsOnTimeline.length > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <Trash2 className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">Timeline references will be removed</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {refsOnTimeline.length} composition item{refsOnTimeline.length > 1 ? 's' : ''} on the timeline will also be deleted.
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
  );
}

// --- Composition card ---

interface CompositionCardProps {
  composition: SubComposition;
  viewMode: 'grid' | 'list';
  isInsideSubComp: boolean;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onEnter: (comp: SubComposition) => void;
  onDelete: (comp: SubComposition) => void;
  onStartRename: (comp: SubComposition) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
}

function CompositionCard({
  composition,
  viewMode,
  isInsideSubComp,
  isEditing,
  editValue,
  onEditValueChange,
  onEnter,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: CompositionCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isInsideSubComp) {
        e.preventDefault();
        return;
      }
      const data = {
        type: 'composition' as const,
        compositionId: composition.id,
        name: composition.name,
        durationInFrames: composition.durationInFrames,
        width: composition.width,
        height: composition.height,
      };
      e.dataTransfer.setData('application/json', JSON.stringify(data));
      e.dataTransfer.effectAllowed = 'copy';
      setMediaDragData(data);
    },
    [composition, isInsideSubComp]
  );

  const handleDragEnd = useCallback(() => {
    clearMediaDragData();
  }, []);

  const handleDoubleClick = useCallback(() => {
    onEnter(composition);
  }, [composition, onEnter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onCommitRename(composition.id);
      } else if (e.key === 'Escape') {
        onCancelRename();
      }
    },
    [composition.id, onCommitRename, onCancelRename]
  );

  const itemCount = composition.items.length;
  const fps = composition.fps || 30;
  const durationSecs = composition.durationInFrames / fps;
  const durationLabel =
    durationSecs < 60
      ? `${durationSecs.toFixed(1)}s`
      : `${Math.floor(durationSecs / 60)}:${String(Math.floor(durationSecs % 60)).padStart(2, '0')}`;

  if (viewMode === 'grid') {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable={!isInsideSubComp && !isEditing}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDoubleClick={handleDoubleClick}
            className={cn(
              'group relative panel-bg border-2 rounded-lg overflow-hidden transition-all duration-300 aspect-square flex flex-col hover:scale-[1.02]',
              isInsideSubComp
                ? 'opacity-50 cursor-not-allowed border-border'
                : 'cursor-grab border-border hover:border-violet-500/50 hover:shadow-lg hover:shadow-violet-500/10'
            )}
          >
            {/* Thumbnail area â€” gradient with centered icon */}
            <div className="flex-1 bg-secondary relative overflow-hidden min-h-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30">
              <Layers className="w-8 h-8 text-violet-400/70" />

              {/* Bottom overlay badges */}
              <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
                <div className="p-0.5 rounded bg-violet-600/90 text-white">
                  <Layers className="w-2.5 h-2.5" />
                </div>
                <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                  {durationLabel}
                </div>
              </div>
            </div>

            {/* Footer */}
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

            {/* Film strip edge detail */}
            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
            <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={() => onEnter(composition)}>
            Enter Composition
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onStartRename(composition)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onDelete(composition)}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // List view (default) â€” matches MediaCard list layout
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!isInsideSubComp && !isEditing}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDoubleClick={handleDoubleClick}
          className={cn(
            'group panel-bg border rounded overflow-hidden transition-all duration-200 flex items-center gap-3 p-2',
            isInsideSubComp
              ? 'opacity-50 cursor-not-allowed border-border'
              : 'cursor-grab border-border hover:border-violet-500/50'
          )}
        >
          {/* Thumbnail */}
          <div className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-violet-600/20 to-violet-900/30">
            <Layers className="w-5 h-5 text-violet-400" />
          </div>

          {/* Info */}
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
              <h3 className="text-xs font-medium text-foreground truncate">
                {composition.name}
              </h3>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              {/* Type badge */}
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
        <ContextMenuItem onClick={() => onEnter(composition)}>
          Enter Composition
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onStartRename(composition)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onDelete(composition)}
          className="text-destructive focus:text-destructive"
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

