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
import { transitionRegistry } from '@/domain/timeline/transitions';
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
  basic: { title: 'Basic' },
  wipe: { title: 'Wipe' },
  slide: { title: 'Slide' },
  flip: { title: 'Flip' },
  mask: { title: 'Mask' },
  light: { title: 'Light' },
  custom: { title: 'Custom' },
};

/** Ordered list of categories for UI rendering */
export const TRANSITION_CATEGORY_ORDER: TransitionCategory[] = [
  'basic', 'wipe', 'slide', 'flip', 'mask', 'light', 'custom',
];

/** Direction string → display label + icon name */
const DIRECTION_LABELS: Record<string, { label: string; icon: string }> = {
  'from-left': { label: 'Left', icon: 'ArrowRight' },
  'from-right': { label: 'Right', icon: 'ArrowLeft' },
  'from-top': { label: 'Top', icon: 'ArrowDown' },
  'from-bottom': { label: 'Bottom', icon: 'ArrowUp' },
};

/**
 * Generate PresentationConfig array from the transition registry.
 * Directional transitions produce one config per direction.
 */
function generateConfigsFromRegistry(): PresentationConfig[] {
  const configs: PresentationConfig[] = [];
  const definitions = transitionRegistry.getDefinitions();

  for (const def of definitions) {
    if (def.hasDirection && def.directions && def.directions.length > 0) {
      for (const dir of def.directions) {
        const dirInfo = DIRECTION_LABELS[dir] || { label: dir, icon: def.icon };
        configs.push({
          id: def.id,
          label: dirInfo.label,
          description: `${def.label} ${dirInfo.label.toLowerCase()}`,
          icon: dirInfo.icon,
          category: def.category,
          direction: dir,
        });
      }
    } else {
      configs.push({
        id: def.id,
        label: def.label,
        description: def.description,
        icon: def.icon,
        category: def.category,
      });
    }
  }

  return configs;
}

/** All presentation configs, generated once from the registry */
export const TRANSITION_PRESENTATION_CONFIGS = generateConfigsFromRegistry();

/** Configs grouped by category (for picker UIs) */
export const TRANSITION_CONFIGS_BY_CATEGORY: Record<string, PresentationConfig[]> = {};
/** Start indices per category (for flat-list indexing) */
export const TRANSITION_CATEGORY_START_INDICES: Record<string, number> = {};

{
  for (const config of TRANSITION_PRESENTATION_CONFIGS) {
    if (!TRANSITION_CONFIGS_BY_CATEGORY[config.category]) {
      TRANSITION_CONFIGS_BY_CATEGORY[config.category] = [];
    }
    TRANSITION_CONFIGS_BY_CATEGORY[config.category]!.push(config);
  }

  let running = 0;
  for (const category of TRANSITION_CATEGORY_ORDER) {
    TRANSITION_CATEGORY_START_INDICES[category] = running;
    running += (TRANSITION_CONFIGS_BY_CATEGORY[category]?.length || 0);
  }
}
