/**
 * Shared transition UI configuration.
 * Single source of truth for transition presentation configs,
 * icons, and category metadata — derived from the transition registry.
 */

import {
  Blend,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  MoveRight,
  MoveLeft,
  MoveUp,
  MoveDown,
  FlipHorizontal,
  FlipVertical,
  Clock,
  Circle,
  Sparkles,
  Zap,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { transitionRegistry } from '@/core/timeline/transitions';
import type { PresentationConfig, TransitionCategory } from '@/types/transition';

/** Lucide icon lookup by name string */
export const TRANSITION_ICON_MAP: Record<string, LucideIcon> = {
  Blend,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  MoveRight,
  MoveLeft,
  MoveDown,
  MoveUp,
  FlipHorizontal,
  FlipHorizontal2: FlipHorizontal,
  FlipVertical,
  FlipVertical2: FlipVertical,
  Clock,
  Circle,
  Sparkles,
  Zap,
  Sun,
};

/** Display labels for transition categories */
export const TRANSITION_CATEGORY_INFO: Record<string, { title: string }> = {
  basic: { title: '基础' },
  wipe: { title: '擦除' },
  slide: { title: '滑动' },
  flip: { title: '翻转' },
  mask: { title: '遮罩' },
  light: { title: '光效' },
  chromatic: { title: '色差' },
  custom: { title: '创意' },
};

/** Ordered list of categories for UI rendering */
export const TRANSITION_CATEGORY_ORDER: TransitionCategory[] = [
  'basic', 'wipe', 'slide', 'flip', 'mask', 'light', 'chromatic', 'custom',
];

/** Direction string â†’ display label + icon name */
const DIRECTION_LABELS: Record<string, { label: string; icon: string }> = {
  'from-left': { label: '从左', icon: 'ArrowRight' },
  'from-right': { label: '从右', icon: 'ArrowLeft' },
  'from-top': { label: '从上', icon: 'ArrowDown' },
  'from-bottom': { label: '从下', icon: 'ArrowUp' },
};

const TRANSITION_LABELS: Record<string, string> = {
  Fade: '淡入淡出',
  Dissolve: '溶解',
  Wipe: '擦除',
  Slide: '滑动',
  Flip: '翻转',
  'Clock Wipe': '时钟擦除',
  Iris: '光圈',
  Sparkles: '闪光',
  Glitch: '故障',
  'Light Leak': '漏光',
  Pixelate: '像素化',
  Chromatic: '色差',
  'Radial Blur': '径向模糊',
};

const TRANSITION_DESCRIPTIONS: Record<string, string> = {
  'Simple crossfade between clips': '在两个片段间进行简单交叉淡化',
  'Noise-based organic dissolve between clips': '基于噪声的有机溶解转场',
  'Wipe reveal from one direction': '从单一方向擦除显示下一片段',
  'Slide in from a direction': '从指定方向滑入',
  '3D flip transition': '3D 翻转转场',
  'Circular wipe like a clock hand': '类似时钟指针的圆形擦除',
  'Circular iris expanding/contracting': '圆形光圈扩张/收缩',
  'Twinkling star bursts reveal the next clip': '闪烁星芒揭示下一个片段',
  'Digital glitch with RGB split and block displacement': 'RGB 分离与块状位移的数字故障效果',
  'Warm light sweep revealing the next clip': '暖色光扫过并揭示下一个片段',
  'Mosaic pixelation dissolve between clips': '马赛克像素化溶解转场',
  'RGB channel split with directional sweep': '带方向扫过的 RGB 通道分离',
  'Zoom and spin blur transition': '缩放与旋转模糊转场',
};

function tTransitionLabel(value: string): string {
  return TRANSITION_LABELS[value] ?? value;
}

function tTransitionDescription(value: string): string {
  return TRANSITION_DESCRIPTIONS[value] ?? value;
}

function createConfigsForDefinition(def: ReturnType<typeof transitionRegistry.getDefinitions>[number]): PresentationConfig[] {
  const localizedBaseLabel = tTransitionLabel(def.label);
  if (def.hasDirection && def.directions && def.directions.length > 0) {
    return def.directions.map((dir) => {
      const dirInfo = DIRECTION_LABELS[dir] || { label: dir, icon: def.icon };
      return {
        id: def.id,
        label: dirInfo.label,
        description: `${localizedBaseLabel}（${dirInfo.label}）`,
        icon: dirInfo.icon,
        category: def.category,
        direction: dir,
      };
    });
  }

  return [{
    id: def.id,
    label: localizedBaseLabel,
    description: tTransitionDescription(def.description),
    icon: def.icon,
    category: def.category,
  }];
}

/**
 * Generate PresentationConfig array from the transition registry.
 * Directional transitions produce one config per direction.
 * The flat list is grouped in the same category order used by picker UIs so
 * category-based index math stays stable.
 */
function generateConfigsFromRegistry(): PresentationConfig[] {
  const groupedConfigs = new Map<string, PresentationConfig[]>();
  const uncategorizedConfigs: PresentationConfig[] = [];
  const categoryOrder = new Set<string>(TRANSITION_CATEGORY_ORDER);

  for (const def of transitionRegistry.getDefinitions()) {
    const configs = createConfigsForDefinition(def);
    if (!categoryOrder.has(def.category)) {
      uncategorizedConfigs.push(...configs);
      continue;
    }

    const existing = groupedConfigs.get(def.category) ?? [];
    existing.push(...configs);
    groupedConfigs.set(def.category, existing);
  }

  return [
    ...TRANSITION_CATEGORY_ORDER.flatMap((category) => groupedConfigs.get(category) ?? []),
    ...uncategorizedConfigs,
  ];
}

// Lazy-initialized caches — avoids TDZ when bundler orders this module
// before the transition registry is populated (see CLAUDE.md gotchas).
let _presentationConfigs: PresentationConfig[] | null = null;
let _configsByCategory: Record<string, PresentationConfig[]> | null = null;
let _categoryStartIndices: Record<string, number> | null = null;

function ensureInitialized(): void {
  if (_presentationConfigs) return;

  _presentationConfigs = generateConfigsFromRegistry();
  _configsByCategory = {};
  _categoryStartIndices = {};

  for (const config of _presentationConfigs) {
    if (!_configsByCategory[config.category]) {
      _configsByCategory[config.category] = [];
    }
    _configsByCategory[config.category]!.push(config);
  }

  let running = 0;
  for (const category of TRANSITION_CATEGORY_ORDER) {
    _categoryStartIndices[category] = running;
    running += (_configsByCategory[category]?.length || 0);
  }
}

/** All presentation configs, generated once from the registry */
export function getTransitionPresentationConfigs(): PresentationConfig[] {
  ensureInitialized();
  return _presentationConfigs!;
}

/** Configs grouped by category (for picker UIs) */
export function getTransitionConfigsByCategory(): Record<string, PresentationConfig[]> {
  ensureInitialized();
  return _configsByCategory!;
}

/** Start indices per category (for flat-list indexing) */
export function getTransitionCategoryStartIndices(): Record<string, number> {
  ensureInitialized();
  return _categoryStartIndices!;
}
