/**
 * Bento Layout — compute grid/special arrangements for selected timeline items.
 * Pure layout calculation, no store dependencies.
 */

import type { TransformProperties } from '@/types/transform';
import type { ClipTransitionIndex } from '@/types/transition';

// ── Transition chain grouping ────────────────────────────────────────────

/**
 * Build transition chains from a set of item IDs.
 * Items connected by transitions are grouped into ordered chains.
 * Items without transitions become single-item chains.
 *
 * @returns Array of chains, each an ordered array of item IDs (left→right).
 */
export function buildTransitionChains(
  itemIds: string[],
  transitionsByClipId: Map<string, ClipTransitionIndex>,
): string[][] {
  const itemIdSet = new Set(itemIds);
  const visited = new Set<string>();
  const chains: string[][] = [];

  for (const id of itemIds) {
    if (visited.has(id)) continue;

    // Walk backwards to find the start of this chain
    let start = id;
    const backwardVisited = new Set<string>();
    while (true) {
      const index = transitionsByClipId.get(start);
      if (
        index?.incoming &&
        itemIdSet.has(index.incoming.leftClipId) &&
        !visited.has(index.incoming.leftClipId) &&
        !backwardVisited.has(index.incoming.leftClipId)
      ) {
        backwardVisited.add(start);
        start = index.incoming.leftClipId;
      } else {
        break;
      }
    }

    // Walk forward to build the chain
    const chain: string[] = [];
    let current: string | undefined = start;
    while (current && itemIdSet.has(current) && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const index = transitionsByClipId.get(current);
      current = index?.outgoing?.rightClipId;
    }

    if (chain.length > 0) {
      chains.push(chain);
    }
  }

  return chains;
}

// ── Types ────────────────────────────────────────────────────────────────

export type LayoutPresetType = 'auto' | 'row' | 'column' | 'pip' | 'focus-sidebar' | 'grid';

export interface LayoutConfig {
  preset: LayoutPresetType;
  /** Fixed column count (used by 'grid' preset) */
  cols?: number;
  /** Fixed row count (used by 'grid' preset) */
  rows?: number;
  /** Gap between cells in pixels (default 8) */
  gap?: number;
  /** Padding around the entire layout in pixels (default 0) */
  padding?: number;
}

export interface BentoLayoutOptions {
  /** Gap between cells in pixels (default 8) */
  gap?: number;
  /** Padding around the entire grid in pixels (default 0) */
  padding?: number;
}

export interface BentoLayoutItem {
  id: string;
  sourceWidth: number;
  sourceHeight: number;
}

// ── Grid helpers ─────────────────────────────────────────────────────────

/**
 * Compute grid dimensions for N items.
 * Cols = ceil(sqrt(n)), rows = ceil(n / cols).
 */
export function computeGridDimensions(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

// ── Fit-contain helper ───────────────────────────────────────────────────

function fitContain(
  sourceW: number,
  sourceH: number,
  cellW: number,
  cellH: number,
): { width: number; height: number } {
  const scale = Math.min(cellW / sourceW, cellH / sourceH);
  return {
    width: Math.round(sourceW * scale),
    height: Math.round(sourceH * scale),
  };
}

// ── Grid layout (shared by auto / row / column / grid) ───────────────────

/**
 * Compute bento layout transforms for a set of items in a grid arrangement.
 * Returns a map of item ID -> TransformProperties with center-relative coordinates.
 */
export function computeBentoLayout(
  items: BentoLayoutItem[],
  canvasWidth: number,
  canvasHeight: number,
  options?: BentoLayoutOptions,
): Map<string, TransformProperties> {
  return computeGridLayout(items, canvasWidth, canvasHeight, {
    preset: 'auto',
    gap: options?.gap,
    padding: options?.padding,
  });
}

function computeGridLayout(
  items: BentoLayoutItem[],
  canvasWidth: number,
  canvasHeight: number,
  config: LayoutConfig,
): Map<string, TransformProperties> {
  const result = new Map<string, TransformProperties>();
  if (items.length === 0) return result;

  const gap = config.gap ?? 0;
  const padding = config.padding ?? 0;

  // Determine cols/rows based on preset
  let cols: number;
  let rows: number;

  switch (config.preset) {
    case 'row':
      cols = items.length;
      rows = 1;
      break;
    case 'column':
      cols = 1;
      rows = items.length;
      break;
    case 'grid':
      cols = config.cols ?? 2;
      rows = config.rows ?? 2;
      break;
    default: { // 'auto'
      const dims = computeGridDimensions(items.length);
      cols = dims.cols;
      rows = dims.rows;
      break;
    }
  }

  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const cellWidth = (availableWidth - gap * (cols - 1)) / cols;
  const cellHeight = (availableHeight - gap * (rows - 1)) / rows;

  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);

    const cellX = padding + col * (cellWidth + gap);
    const cellY = padding + row * (cellHeight + gap);

    const fit = fitContain(item.sourceWidth, item.sourceHeight, cellWidth, cellHeight);

    const itemCenterX = cellX + cellWidth / 2;
    const itemCenterY = cellY + cellHeight / 2;

    result.set(item.id, {
      x: itemCenterX - canvasCenterX,
      y: itemCenterY - canvasCenterY,
      width: fit.width,
      height: fit.height,
      rotation: 0,
    });
  }

  return result;
}

// ── Picture-in-Picture layout ────────────────────────────────────────────

function computePipLayout(
  items: BentoLayoutItem[],
  canvasWidth: number,
  canvasHeight: number,
  config: LayoutConfig,
): Map<string, TransformProperties> {
  const result = new Map<string, TransformProperties>();
  if (items.length === 0) return result;

  const gap = config.gap ?? 0;
  const padding = config.padding ?? 0;

  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;

  // First item fills the available area (fit-contain)
  const main = items[0]!;
  const mainFit = fitContain(main.sourceWidth, main.sourceHeight, availableWidth, availableHeight);
  result.set(main.id, {
    x: 0,
    y: 0,
    width: mainFit.width,
    height: mainFit.height,
    rotation: 0,
  });

  if (items.length < 2) return result;

  // Remaining items: 1/4 canvas width, stacked in bottom-right corner
  const pipWidth = availableWidth / 4;
  const pipItems = items.slice(1);

  // Stack pip items from bottom-right, going upward
  const totalPipHeight = pipItems.reduce((acc, item) => {
    const fit = fitContain(item.sourceWidth, item.sourceHeight, pipWidth, pipWidth);
    return acc + fit.height;
  }, 0) + gap * (pipItems.length - 1);

  // Bottom-right anchor: right edge at (padding + availableWidth), bottom edge at (padding + availableHeight)
  const rightEdge = padding + availableWidth;
  let currentBottom = padding + availableHeight;

  // If total pip height exceeds available height, scale down proportionally
  const maxPipHeight = availableHeight;
  const pipScale = totalPipHeight > maxPipHeight ? maxPipHeight / totalPipHeight : 1;

  for (let i = pipItems.length - 1; i >= 0; i--) {
    const item = pipItems[i]!;
    const effectivePipWidth = pipWidth * pipScale;
    const fit = fitContain(item.sourceWidth, item.sourceHeight, effectivePipWidth, effectivePipWidth);

    const itemCenterX = rightEdge - effectivePipWidth / 2 - gap;
    const itemCenterY = currentBottom - fit.height / 2 - gap;

    result.set(item.id, {
      x: itemCenterX - canvasCenterX,
      y: itemCenterY - canvasCenterY,
      width: fit.width,
      height: fit.height,
      rotation: 0,
    });

    currentBottom -= fit.height + gap * pipScale;
  }

  return result;
}

// ── Focus + Sidebar layout ───────────────────────────────────────────────

function computeFocusSidebarLayout(
  items: BentoLayoutItem[],
  canvasWidth: number,
  canvasHeight: number,
  config: LayoutConfig,
): Map<string, TransformProperties> {
  const result = new Map<string, TransformProperties>();
  if (items.length === 0) return result;

  const gap = config.gap ?? 0;
  const padding = config.padding ?? 0;

  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;

  // Focus area: left 2/3 (minus half gap)
  const focusWidth = (availableWidth - gap) * 2 / 3;
  const focusHeight = availableHeight;

  // First item fills the focus area
  const main = items[0]!;
  const mainFit = fitContain(main.sourceWidth, main.sourceHeight, focusWidth, focusHeight);

  const focusCenterX = padding + focusWidth / 2;
  const focusCenterY = padding + focusHeight / 2;

  result.set(main.id, {
    x: focusCenterX - canvasCenterX,
    y: focusCenterY - canvasCenterY,
    width: mainFit.width,
    height: mainFit.height,
    rotation: 0,
  });

  if (items.length < 2) return result;

  // Sidebar: right 1/3 (minus half gap)
  const sidebarWidth = (availableWidth - gap) / 3;
  const sidebarX = padding + focusWidth + gap;
  const sidebarItems = items.slice(1);

  // Stack sidebar items vertically with gaps
  const cellHeight = (availableHeight - gap * (sidebarItems.length - 1)) / sidebarItems.length;

  for (let i = 0; i < sidebarItems.length; i++) {
    const item = sidebarItems[i]!;
    const fit = fitContain(item.sourceWidth, item.sourceHeight, sidebarWidth, cellHeight);

    const cellY = padding + i * (cellHeight + gap);
    const itemCenterX = sidebarX + sidebarWidth / 2;
    const itemCenterY = cellY + cellHeight / 2;

    result.set(item.id, {
      x: itemCenterX - canvasCenterX,
      y: itemCenterY - canvasCenterY,
      width: fit.width,
      height: fit.height,
      rotation: 0,
    });
  }

  return result;
}

// ── Main dispatcher ──────────────────────────────────────────────────────

/**
 * Compute layout transforms for a set of items using the specified preset.
 * Returns a map of item ID -> TransformProperties with center-relative coordinates.
 */
export function computeLayout(
  items: BentoLayoutItem[],
  canvasWidth: number,
  canvasHeight: number,
  config: LayoutConfig,
): Map<string, TransformProperties> {
  switch (config.preset) {
    case 'pip':
      return computePipLayout(items, canvasWidth, canvasHeight, config);
    case 'focus-sidebar':
      return computeFocusSidebarLayout(items, canvasWidth, canvasHeight, config);
    case 'auto':
    case 'row':
    case 'column':
    case 'grid':
      return computeGridLayout(items, canvasWidth, canvasHeight, config);
  }
}
