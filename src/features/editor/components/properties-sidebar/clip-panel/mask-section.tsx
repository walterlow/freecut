import { useCallback, useMemo, memo } from 'react';
import { Layers, Trash2, Eye, EyeOff, Circle, Square, Pen, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TimelineItem } from '@/types/timeline';
import type { MaskMode } from '@/types/masks';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  useMaskEditorStore,
  createRectangleMask,
  createEllipseMask,
} from '@/features/editor/deps/preview';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';

interface MaskSectionProps {
  items: TimelineItem[];
}

/**
 * Mask section — manage per-item bezier mask paths.
 * Only shown for single-item selection (multi-item mask editing is too complex).
 */
export const MaskSection = memo(function MaskSection({
  items,
}: MaskSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);
  const {
    isEditing, editingItemId, selectedMaskIndex, penMode,
    startEditing, stopEditing, selectMask, startPenMode, cancelPenMode,
  } = useMaskEditorStore();

  const item = items.length === 1 ? items[0]! : null;
  const masks = item?.masks ?? [];
  const selectedMask = masks[selectedMaskIndex] ?? null;

  const isEditingThisItem = isEditing && editingItemId === item?.id;
  const isPenModeThisItem = penMode && editingItemId === item?.id;

  // Add a new mask preset
  const addMask = useCallback(
    (type: 'rectangle' | 'ellipse') => {
      if (!item) return;
      const newMask = type === 'rectangle' ? createRectangleMask() : createEllipseMask();
      const newMasks = [...masks, newMask];
      updateItem(item.id, { masks: newMasks });
      // Auto-enter edit mode on the new mask
      startEditing(item.id, newMasks.length - 1);
    },
    [item, masks, updateItem, startEditing]
  );

  // Remove the selected mask
  const removeMask = useCallback(() => {
    if (!item || masks.length === 0) return;
    const newMasks = masks.filter((_, i) => i !== selectedMaskIndex);
    updateItem(item.id, { masks: newMasks.length > 0 ? newMasks : undefined });
    if (selectedMaskIndex >= newMasks.length) {
      selectMask(Math.max(0, newMasks.length - 1));
    }
    if (newMasks.length === 0) {
      stopEditing();
    }
  }, [item, masks, selectedMaskIndex, updateItem, selectMask, stopEditing]);

  // Toggle mask enabled
  const toggleEnabled = useCallback(() => {
    if (!item || !selectedMask) return;
    const newMasks = [...masks];
    newMasks[selectedMaskIndex] = { ...selectedMask, enabled: !selectedMask.enabled };
    updateItem(item.id, { masks: newMasks });
  }, [item, masks, selectedMaskIndex, selectedMask, updateItem]);

  // Toggle mask inverted
  const toggleInverted = useCallback(() => {
    if (!item || !selectedMask) return;
    const newMasks = [...masks];
    newMasks[selectedMaskIndex] = { ...selectedMask, inverted: !selectedMask.inverted };
    updateItem(item.id, { masks: newMasks });
  }, [item, masks, selectedMaskIndex, selectedMask, updateItem]);

  // Update mask mode
  const handleModeChange = useCallback(
    (mode: string) => {
      if (!item || !selectedMask) return;
      const newMasks = [...masks];
      newMasks[selectedMaskIndex] = { ...selectedMask, mode: mode as MaskMode };
      updateItem(item.id, { masks: newMasks });
    },
    [item, masks, selectedMaskIndex, selectedMask, updateItem]
  );

  // Build updated masks array with property changes on the selected mask
  const buildMasks = useCallback(
    (updates: Partial<{ opacity: number; feather: number }>) => {
      if (!item) return null;
      const currentMasks = [...(item.masks ?? [])];
      const mask = currentMasks[selectedMaskIndex];
      if (!mask) return null;
      currentMasks[selectedMaskIndex] = { ...mask, ...updates };
      return currentMasks;
    },
    [item, selectedMaskIndex]
  );

  // Live: write to preview store for instant visual feedback (bypasses React prop chain)
  const handleFeatherLiveChange = useCallback(
    (value: number) => {
      const newMasks = buildMasks({ feather: value });
      if (newMasks) useMaskEditorStore.getState().setPreviewMasks(newMasks);
    },
    [buildMasks]
  );

  const handleOpacityLiveChange = useCallback(
    (value: number) => {
      const newMasks = buildMasks({ opacity: value / 100 });
      if (newMasks) useMaskEditorStore.getState().setPreviewMasks(newMasks);
    },
    [buildMasks]
  );

  // Commit: update store with undo support (on mouse up), clear preview
  const handleFeatherChange = useCallback(
    (value: number) => {
      useMaskEditorStore.getState().clearPreviewMasks();
      const newMasks = buildMasks({ feather: value });
      if (item && newMasks) updateItem(item.id, { masks: newMasks });
    },
    [buildMasks, item, updateItem]
  );

  const handleOpacityChange = useCallback(
    (value: number) => {
      useMaskEditorStore.getState().clearPreviewMasks();
      const newMasks = buildMasks({ opacity: value / 100 });
      if (item && newMasks) updateItem(item.id, { masks: newMasks });
    },
    [buildMasks, item, updateItem]
  );

  // Toggle edit mode
  const toggleEditMode = useCallback(() => {
    if (isEditingThisItem) {
      stopEditing();
    } else if (item && masks.length > 0) {
      startEditing(item.id, selectedMaskIndex);
    }
  }, [isEditingThisItem, item, masks.length, selectedMaskIndex, startEditing, stopEditing]);

  // Toggle pen tool mode
  const togglePenMode = useCallback(() => {
    if (isPenModeThisItem) {
      cancelPenMode();
    } else if (item) {
      startPenMode(item.id);
    }
  }, [isPenModeThisItem, item, startPenMode, cancelPenMode]);

  // Mask list labels
  const maskLabels = useMemo(
    () => masks.map((m, i) => `Mask ${i + 1}${!m.enabled ? ' (off)' : ''}`),
    [masks]
  );

  if (!item || items.length > 1) return null;

  const isActiveEditing = isEditingThisItem || isPenModeThisItem;

  return (
    <PropertySection title="Masks" icon={Layers} defaultOpen={true}>
      {/* Editing banner — shown when editing or drawing a mask */}
      {isActiveEditing && (
        <div className="mx-1 mb-2 px-2 py-1.5 rounded-md bg-accent/50 border border-accent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isPenModeThisItem ? (
                <Pen className="w-3 h-3 text-foreground" />
              ) : (
                <MousePointer2 className="w-3 h-3 text-foreground" />
              )}
              <span className="text-[11px] font-medium text-foreground">
                {isPenModeThisItem ? 'Drawing mask' : 'Editing path'}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={isPenModeThisItem ? cancelPenMode : stopEditing}
            >
              Done
            </Button>
          </div>
          {isPenModeThisItem && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Click to place points. Drag to create curves. Click first point to close.
            </p>
          )}
          {isEditingThisItem && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Drag points to reshape. Double-click segment to add. Right-click to remove.
            </p>
          )}
        </div>
      )}

      {/* Add mask buttons — hidden while editing */}
      {!isActiveEditing && (
        <div className="flex items-center gap-1 px-1 mb-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1 gap-1"
            onClick={() => addMask('rectangle')}
          >
            <Square className="w-3 h-3" />
            Rect
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1 gap-1"
            onClick={() => addMask('ellipse')}
          >
            <Circle className="w-3 h-3" />
            Ellipse
          </Button>
          <Button
            variant={isPenModeThisItem ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs flex-1 gap-1"
            onClick={togglePenMode}
            title="Draw mask with pen tool"
          >
            <Pen className="w-3 h-3" />
            Pen
          </Button>
        </div>
      )}

      {masks.length > 0 && (
        <>
          {/* Mask selector + controls */}
          <div className="flex items-center gap-1 px-1 mb-2">
            <Select
              value={String(selectedMaskIndex)}
              onValueChange={(v) => {
                const idx = parseInt(v, 10);
                selectMask(idx);
                if (isEditingThisItem) {
                  startEditing(item.id, idx);
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {maskLabels.map((label, i) => (
                  <SelectItem key={i} value={String(i)} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Edit toggle — only when not in pen mode */}
            {!isPenModeThisItem && (
              <Button
                variant={isEditingThisItem ? 'default' : 'outline'}
                size="icon"
                className="h-7 w-7 flex-shrink-0"
                onClick={toggleEditMode}
                title={isEditingThisItem ? 'Exit mask editor' : 'Edit mask path'}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={toggleEnabled}
              title={selectedMask?.enabled ? 'Disable mask' : 'Enable mask'}
            >
              {selectedMask?.enabled ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0 text-destructive"
              onClick={removeMask}
              title="Delete mask"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Mask properties */}
          {selectedMask && (
            <>
              <PropertyRow label="Mode">
                <Select value={selectedMask.mode} onValueChange={handleModeChange}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add" className="text-xs">Add</SelectItem>
                    <SelectItem value="subtract" className="text-xs">Subtract</SelectItem>
                    <SelectItem value="intersect" className="text-xs">Intersect</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>

              <PropertyRow label="Opacity">
                <div className="flex items-center gap-1 w-full">
                  <SliderInput
                    value={Math.round(selectedMask.opacity * 100)}
                    onChange={handleOpacityChange}
                    onLiveChange={handleOpacityLiveChange}
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    className="flex-1 min-w-0"
                  />
                </div>
              </PropertyRow>

              <PropertyRow label="Feather">
                <div className="flex items-center gap-1 w-full">
                  <SliderInput
                    value={selectedMask.feather}
                    onChange={handleFeatherChange}
                    onLiveChange={handleFeatherLiveChange}
                    min={0}
                    max={200}
                    step={0.5}
                    unit="px"
                    className="flex-1 min-w-0"
                  />
                </div>
              </PropertyRow>

              <PropertyRow label="Invert">
                <Button
                  variant={selectedMask.inverted ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={toggleInverted}
                >
                  {selectedMask.inverted ? 'Inverted' : 'Normal'}
                </Button>
              </PropertyRow>
            </>
          )}
        </>
      )}
    </PropertySection>
  );
});
