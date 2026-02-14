import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useBentoLayoutDialogStore } from './bento-layout-dialog-store';
import { useBentoPresetsStore } from '../stores/bento-presets-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { useItemsStore } from '../stores/items-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { applyBentoLayout } from '../stores/actions/transform-actions';
import { computeLayout, buildTransitionChains } from '../utils/bento-layout';
import { buildTransitionIndexes } from '../utils/transition-indexes';
import type { LayoutPresetType, LayoutConfig, BentoLayoutItem } from '../utils/bento-layout';
import type { TimelineItem } from '@/types/timeline';

// ── Built-in presets ─────────────────────────────────────────────────────

interface BuiltInPreset {
  type: LayoutPresetType;
  label: string;
  cols?: number;
  rows?: number;
}

const BUILT_IN_PRESETS: BuiltInPreset[] = [
  { type: 'auto', label: 'Auto' },
  { type: 'row', label: 'Side by Side' },
  { type: 'column', label: 'Stacked' },
  { type: 'pip', label: 'PiP' },
  { type: 'focus-sidebar', label: 'Focus+Sidebar' },
  { type: 'grid', label: '2\u00D72', cols: 2, rows: 2 },
  { type: 'grid', label: '3\u00D73', cols: 3, rows: 3 },
];

// ── Item type colors ─────────────────────────────────────────────────────

const ITEM_TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  video: { bg: 'bg-blue-500/60', border: 'border-blue-400/80' },
  image: { bg: 'bg-green-500/60', border: 'border-green-400/80' },
  text: { bg: 'bg-amber-500/60', border: 'border-amber-400/80' },
  shape: { bg: 'bg-purple-500/60', border: 'border-purple-400/80' },
  adjustment: { bg: 'bg-violet-500/60', border: 'border-violet-400/80' },
};

const DEFAULT_COLOR = { bg: 'bg-muted-foreground/40', border: 'border-muted-foreground/60' };

function getItemColor(type: string) {
  return ITEM_TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

// ── Number input helper ──────────────────────────────────────────────────

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="w-16 h-7 text-xs px-2"
      />
    </div>
  );
}

// ── Layout canvas item ───────────────────────────────────────────────────

interface CanvasItemRect {
  id: string;
  label: string;
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function CanvasItem({
  rect,
  isDragging,
  isDropTarget,
  dragOffset,
  onMouseDown,
}: {
  rect: CanvasItemRect;
  isDragging: boolean;
  isDropTarget: boolean;
  dragOffset: { x: number; y: number } | null;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const color = getItemColor(rect.type);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    transform: isDragging && dragOffset
      ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
      : undefined,
    zIndex: isDragging ? 50 : 1,
    transition: isDragging ? 'none' : 'left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease',
  };

  return (
    <div
      style={style}
      onMouseDown={onMouseDown}
      className={cn(
        'rounded border select-none cursor-grab overflow-hidden',
        'flex items-center justify-center',
        color.bg,
        color.border,
        isDragging && 'shadow-lg opacity-80 cursor-grabbing',
        isDropTarget && 'ring-2 ring-primary ring-dashed',
        !isDragging && 'hover:brightness-110',
      )}
    >
      <span className="text-[10px] text-white font-medium truncate px-1 pointer-events-none drop-shadow-sm">
        {rect.label}
      </span>
    </div>
  );
}

// ── Layout canvas ────────────────────────────────────────────────────────

function LayoutCanvas({
  chainOrder,
  onSwap,
  canvasWidth,
  canvasHeight,
  config,
  itemsLookup,
}: {
  /** Ordered chains — each chain is a group of item IDs sharing one layout cell */
  chainOrder: string[][];
  onSwap: (fromIndex: number, toIndex: number) => void;
  canvasWidth: number;
  canvasHeight: number;
  config: LayoutConfig;
  itemsLookup: Map<string, TimelineItem>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute display scale (guard against zero/missing canvas dimensions)
  const safeCanvasWidth = canvasWidth > 0 ? canvasWidth : 1920;
  const safeCanvasHeight = canvasHeight > 0 ? canvasHeight : 1080;
  const aspectRatio = safeCanvasWidth / safeCanvasHeight;
  const displayWidth = containerWidth;
  const displayHeight = containerWidth > 0 ? displayWidth / aspectRatio : 200;
  const scale = containerWidth > 0 ? displayWidth / safeCanvasWidth : 1;

  // Build one layout item per chain (representative = first item in chain)
  const layoutItems: BentoLayoutItem[] = useMemo(() => {
    return chainOrder.map((chain) => {
      const repId = chain[0]!;
      const item = itemsLookup.get(repId);
      const sw = item && 'sourceWidth' in item && item.sourceWidth ? item.sourceWidth : safeCanvasWidth;
      const sh = item && 'sourceHeight' in item && item.sourceHeight ? item.sourceHeight : safeCanvasHeight;
      return { id: repId, sourceWidth: sw, sourceHeight: sh };
    });
  }, [chainOrder, itemsLookup, safeCanvasWidth, safeCanvasHeight]);

  const transformsMap = useMemo(() => {
    if (layoutItems.length === 0) return new Map<string, { x?: number; y?: number; width?: number; height?: number }>();
    return computeLayout(layoutItems, safeCanvasWidth, safeCanvasHeight, config);
  }, [layoutItems, safeCanvasWidth, safeCanvasHeight, config]);

  // Convert center-relative coords to absolute top-left, then scale — one rect per chain
  const canvasRects: CanvasItemRect[] = useMemo(() => {
    const cx = safeCanvasWidth / 2;
    const cy = safeCanvasHeight / 2;
    return chainOrder.map((chain) => {
      const repId = chain[0]!;
      const t = transformsMap.get(repId);
      const item = itemsLookup.get(repId);
      const w = t?.width ?? safeCanvasWidth;
      const h = t?.height ?? safeCanvasHeight;
      const absLeft = cx + (t?.x ?? 0) - w / 2;
      const absTop = cy + (t?.y ?? 0) - h / 2;
      // Build label: show all item labels in the chain
      const label = chain.length === 1
        ? (item?.label ?? repId.slice(0, 6))
        : chain.map((id) => itemsLookup.get(id)?.label ?? id.slice(0, 4)).join(' \u2192 ');
      return {
        id: repId,
        label,
        type: item?.type ?? 'video',
        left: absLeft * scale,
        top: absTop * scale,
        width: w * scale,
        height: h * scale,
      };
    });
  }, [chainOrder, transformsMap, itemsLookup, safeCanvasWidth, safeCanvasHeight, scale]);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  // Hit-test: find which canvas rect the cursor is over
  const hitTest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = containerRef.current;
      if (!el) return null;
      const bounds = el.getBoundingClientRect();
      const px = clientX - bounds.left;
      const py = clientY - bounds.top;
      for (let i = 0; i < canvasRects.length; i++) {
        const r = canvasRects[i]!;
        if (px >= r.left && px <= r.left + r.width && py >= r.top && py <= r.top + r.height) {
          return i;
        }
      }
      return null;
    },
    [canvasRects],
  );

  // Window-level mouse handlers for drag
  useEffect(() => {
    if (dragIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      setDragOffset({
        x: e.clientX - dragStartPos.current.x,
        y: e.clientY - dragStartPos.current.y,
      });
      const target = hitTest(e.clientX, e.clientY);
      setDropTargetIndex(target !== null && target !== dragIndex ? target : null);
    };

    const handleMouseUp = () => {
      if (dragIndex !== null && dropTargetIndex !== null && dropTargetIndex !== dragIndex) {
        onSwap(dragIndex, dropTargetIndex);
      }
      setDragIndex(null);
      setDragOffset(null);
      setDropTargetIndex(null);
      dragStartPos.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragIndex, dropTargetIndex, hitTest, onSwap]);

  const handleItemMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      setDragIndex(index);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      setDragOffset({ x: 0, y: 0 });
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-md border border-border bg-muted/30 overflow-hidden"
      style={{ height: displayHeight > 0 ? displayHeight : 200 }}
    >
      {canvasRects.map((rect, i) => (
        <CanvasItem
          key={rect.id}
          rect={rect}
          isDragging={dragIndex === i}
          isDropTarget={dropTargetIndex === i}
          dragOffset={dragIndex === i ? dragOffset : null}
          onMouseDown={(e) => handleItemMouseDown(i, e)}
        />
      ))}
      {canvasRects.length === 0 && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          No items to arrange
        </div>
      )}
    </div>
  );
}

// ── Preset strip ─────────────────────────────────────────────────────────

type SelectedPreset =
  | { kind: 'builtin'; index: number }
  | { kind: 'custom'; id: string };

// ── Main dialog ──────────────────────────────────────────────────────────

export function BentoLayoutDialog() {
  const isOpen = useBentoLayoutDialogStore((s) => s.isOpen);
  const itemIds = useBentoLayoutDialogStore((s) => s.itemIds);
  const close = useBentoLayoutDialogStore((s) => s.close);

  const customPresets = useBentoPresetsStore((s) => s.customPresets);
  const addPreset = useBentoPresetsStore((s) => s.addPreset);
  const removePreset = useBentoPresetsStore((s) => s.removePreset);

  const canvasWidth = useProjectStore((s) => s.currentProject?.metadata.width ?? 1920);
  const canvasHeight = useProjectStore((s) => s.currentProject?.metadata.height ?? 1080);

  const [selected, setSelected] = useState<SelectedPreset>({ kind: 'builtin', index: 0 });
  const [gap, setGap] = useState(0);
  const [padding, setPadding] = useState(0);
  /** Chain order — each entry is a chain (group of transition-connected item IDs) */
  const [chainOrder, setChainOrder] = useState<string[][]>([]);

  // Save preset inline state
  const [isSaving, setIsSaving] = useState(false);
  const [presetName, setPresetName] = useState('');

  // Build transition chains when dialog opens
  const transitions = useTransitionsStore((s) => s.transitions);

  // Sync chainOrder when dialog opens or itemIds change
  useEffect(() => {
    if (isOpen && itemIds.length > 0) {
      const { transitionsByClipId } = buildTransitionIndexes(transitions);
      const chains = buildTransitionChains(itemIds, transitionsByClipId);
      setChainOrder(chains);
      setSelected({ kind: 'builtin', index: 0 });
      setGap(0);
      setPadding(0);
      setIsSaving(false);
      setPresetName('');
    }
  }, [isOpen, itemIds, transitions]);

  // Look up items from store (reactive)
  const items = useItemsStore((state) => state.items);
  const itemsLookup = useMemo(() => {
    const map = new Map<string, TimelineItem>();
    for (const id of itemIds) {
      const item = items.find((i) => i.id === id);
      if (item) map.set(id, item);
    }
    return map;
  }, [items, itemIds]);

  const itemCount = itemIds.length;

  const resolveConfig = useCallback((): LayoutConfig => {
    if (selected.kind === 'custom') {
      const preset = customPresets.find((p) => p.id === selected.id);
      if (preset) {
        return {
          preset: preset.preset,
          cols: preset.cols,
          rows: preset.rows,
          gap: preset.gap,
          padding: preset.padding,
        };
      }
    }

    const builtin = BUILT_IN_PRESETS[selected.kind === 'builtin' ? selected.index : 0];
    if (!builtin) return { preset: 'auto', gap, padding };

    return {
      preset: builtin.type,
      cols: builtin.cols,
      rows: builtin.rows,
      gap,
      padding,
    };
  }, [selected, customPresets, gap, padding]);

  const config = useMemo(() => resolveConfig(), [resolveConfig]);

  const handleSwap = useCallback((fromIndex: number, toIndex: number) => {
    setChainOrder((prev) => {
      const next = [...prev];
      const temp = next[fromIndex]!;
      next[fromIndex] = next[toIndex]!;
      next[toIndex] = temp;
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    const flatIds = chainOrder.flat();
    if (flatIds.length < 2) return;
    const cfg = resolveConfig();
    // Pass user's drag-swap ordered chains to preserve layout order
    applyBentoLayout(flatIds, canvasWidth, canvasHeight, cfg, chainOrder);
    close();
  }, [chainOrder, canvasWidth, canvasHeight, resolveConfig, close]);

  const handleSavePreset = useCallback(() => {
    const layoutUnitCount = chainOrder.length;
    if (!presetName.trim() || layoutUnitCount < 1) return;

    const cfg = resolveConfig();
    const safeCols = cfg.cols ?? Math.max(1, Math.ceil(Math.sqrt(layoutUnitCount)));
    const safeRows = cfg.rows ?? Math.max(1, Math.ceil(layoutUnitCount / safeCols));
    addPreset({
      name: presetName.trim(),
      preset: cfg.preset,
      cols: safeCols,
      rows: safeRows,
      gap: cfg.gap ?? 0,
      padding: cfg.padding ?? 0,
    });

    setPresetName('');
    setIsSaving(false);
  }, [presetName, resolveConfig, chainOrder.length, addPreset]);

  const handleSelectPreset = useCallback(
    (sel: SelectedPreset) => {
      setSelected(sel);
      // Reset chain order to original when switching presets
      const { transitionsByClipId } = buildTransitionIndexes(transitions);
      setChainOrder(buildTransitionChains(itemIds, transitionsByClipId));

      // For custom presets, also apply their gap/padding
      if (sel.kind === 'custom') {
        const preset = customPresets.find((p) => p.id === sel.id);
        if (preset) {
          setGap(preset.gap);
          setPadding(preset.padding);
        }
      }
    },
    [itemIds, transitions, customPresets],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
        setIsSaving(false);
        setPresetName('');
      }
    },
    [close],
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bento Layout</DialogTitle>
          <DialogDescription>
            Arrange {itemCount} selected clip{itemCount !== 1 ? 's' : ''} — drag items to swap positions
          </DialogDescription>
        </DialogHeader>

        {/* Preset strip */}
        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN_PRESETS.map((preset, idx) => {
            const isSelected = selected.kind === 'builtin' && selected.index === idx;
            return (
              <button
                key={`${preset.type}-${idx}`}
                onClick={() => handleSelectPreset({ kind: 'builtin', index: idx })}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  'hover:bg-accent',
                  isSelected
                    ? 'ring-2 ring-primary bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {preset.label}
              </button>
            );
          })}
          {customPresets.map((preset) => {
            const isSelected = selected.kind === 'custom' && selected.id === preset.id;
            return (
              <div key={preset.id} className="relative group">
                <button
                  onClick={() => handleSelectPreset({ kind: 'custom', id: preset.id })}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    'hover:bg-accent',
                    isSelected
                      ? 'ring-2 ring-primary bg-accent text-accent-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {preset.name}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreset(preset.id);
                    if (isSelected) {
                      setSelected({ kind: 'builtin', index: 0 });
                    }
                  }}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Interactive canvas */}
        <LayoutCanvas
          chainOrder={chainOrder}
          onSwap={handleSwap}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          config={config}
          itemsLookup={itemsLookup}
        />

        {/* Options bar */}
        <div className="flex items-center gap-4">
          <NumberInput label="Gap" value={gap} onChange={setGap} min={0} max={200} />
          <NumberInput label="Padding" value={padding} onChange={setPadding} min={0} max={200} />
        </div>

        {/* Save preset inline */}
        {isSaving ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSavePreset();
                if (e.key === 'Escape') {
                  setIsSaving(false);
                  setPresetName('');
                }
              }}
              className="h-8 text-sm flex-1"
              autoFocus
            />
            <Button size="sm" variant="secondary" onClick={handleSavePreset} disabled={!presetName.trim()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsSaving(false);
                setPresetName('');
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {!isSaving ? (
            <Button variant="secondary" size="sm" onClick={() => setIsSaving(true)}>
              Save as Preset
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={handleApply}>Apply</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
