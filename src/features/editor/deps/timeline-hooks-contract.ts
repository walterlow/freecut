/**
 * Adapter exports for timeline hook dependencies.
 * Editor modules should import timeline feature hooks from here.
 */

export { useTimelineShortcuts } from '@/features/timeline/hooks/use-timeline-shortcuts'
export { useTransitionBreakageNotifications } from '@/features/timeline/hooks/use-transition-breakage-notifications'
export { useFilmstrip } from '@/features/timeline/hooks/use-filmstrip'
export type { FilmstripFrame } from '@/features/timeline/hooks/use-filmstrip'
