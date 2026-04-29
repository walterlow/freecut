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
  Asterisk,
  Columns2,
  MoveRight,
  MoveLeft,
  MoveUp,
  MoveDown,
  FlipHorizontal,
  FlipVertical,
  Clock,
  Circle,
  Diamond,
  Eye,
  Hexagon,
  Heart,
  Pentagon,
  Plus,
  RectangleHorizontal,
  RotateCw,
  Rows3,
  Rows4,
  Square,
  Sparkles,
  Star,
  Triangle,
  Zap,
  Sun,
  Waves,
  ScanSearch,
  SplitSquareVertical,
  PanelTopOpen,
  X,
  Flame,
  Film,
  Droplet,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { transitionRegistry } from '@/core/timeline/transitions'
import type { PresentationConfig, TransitionCategory } from '@/types/transition'

/** Lucide icon lookup by name string */
export const TRANSITION_ICON_MAP: Record<string, LucideIcon> = {
  Blend,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Asterisk,
  Columns2,
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
  Diamond,
  Eye,
  Hexagon,
  Heart,
  Pentagon,
  Plus,
  RectangleHorizontal,
  RotateCw,
  Rows3,
  Rows4,
  Square,
  Sparkles,
  Star,
  Triangle,
  Zap,
  Sun,
  Waves,
  ScanSearch,
  SplitSquareVertical,
  PanelTopOpen,
  X,
  Flame,
  Film,
  Droplet,
  Layers,
}

/** Display labels for transition categories */
export const TRANSITION_CATEGORY_INFO: Record<string, { title: string }> = {
  basic: { title: 'Basic' },
  dissolve: { title: 'Dissolve' },
  motion: { title: 'Motion' },
  wipe: { title: 'Wipe' },
  slide: { title: 'Slide' },
  flip: { title: 'Flip' },
  mask: { title: 'Mask' },
  iris: { title: 'Iris' },
  shape: { title: 'Shape' },
  light: { title: 'Light' },
  chromatic: { title: 'Chromatic' },
  custom: { title: 'Custom' },
}

/** Ordered list of categories for UI rendering */
export const TRANSITION_CATEGORY_ORDER: TransitionCategory[] = [
  'basic',
  'dissolve',
  'motion',
  'wipe',
  'mask',
  'iris',
  'shape',
  'custom',
]

/** Direction string â†’ display label + icon name */
function createConfigsForDefinition(
  def: ReturnType<typeof transitionRegistry.getDefinitions>[number],
): PresentationConfig[] {
  return [
    {
      id: def.id,
      label: def.label,
      description: def.description,
      icon: def.icon,
      category: def.category,
      directions: def.hasDirection ? def.directions : undefined,
      defaultDirection: def.hasDirection ? def.directions?.[0] : undefined,
    },
  ]
}

/**
 * Generate PresentationConfig array from the transition registry.
 * Directional transitions produce one config and expose direction as a property.
 * The flat list is grouped in the same category order used by picker UIs so
 * category-based index math stays stable.
 */
function generateConfigsFromRegistry(): PresentationConfig[] {
  const groupedConfigs = new Map<string, PresentationConfig[]>()
  const uncategorizedConfigs: PresentationConfig[] = []
  const categoryOrder = new Set<string>(TRANSITION_CATEGORY_ORDER)

  for (const def of transitionRegistry.getDefinitions()) {
    const configs = createConfigsForDefinition(def)
    if (!categoryOrder.has(def.category)) {
      uncategorizedConfigs.push(...configs)
      continue
    }

    const existing = groupedConfigs.get(def.category) ?? []
    existing.push(...configs)
    groupedConfigs.set(def.category, existing)
  }

  return [
    ...TRANSITION_CATEGORY_ORDER.flatMap((category) => groupedConfigs.get(category) ?? []),
    ...uncategorizedConfigs,
  ]
}

// Lazy-initialized caches — avoids TDZ when bundler orders this module
// before the transition registry is populated (see CLAUDE.md gotchas).
let _presentationConfigs: PresentationConfig[] | null = null
let _configsByCategory: Record<string, PresentationConfig[]> | null = null
let _categoryStartIndices: Record<string, number> | null = null

function ensureInitialized(): void {
  if (_presentationConfigs) return

  _presentationConfigs = generateConfigsFromRegistry()
  _configsByCategory = {}
  _categoryStartIndices = {}

  for (const config of _presentationConfigs) {
    if (!_configsByCategory[config.category]) {
      _configsByCategory[config.category] = []
    }
    _configsByCategory[config.category]!.push(config)
  }

  let running = 0
  for (const category of TRANSITION_CATEGORY_ORDER) {
    _categoryStartIndices[category] = running
    running += _configsByCategory[category]?.length || 0
  }
}

/** All presentation configs, generated once from the registry */
export function getTransitionPresentationConfigs(): PresentationConfig[] {
  ensureInitialized()
  return _presentationConfigs!
}

/** Configs grouped by category (for picker UIs) */
export function getTransitionConfigsByCategory(): Record<string, PresentationConfig[]> {
  ensureInitialized()
  return _configsByCategory!
}

/** Start indices per category (for flat-list indexing) */
export function getTransitionCategoryStartIndices(): Record<string, number> {
  ensureInitialized()
  return _categoryStartIndices!
}
