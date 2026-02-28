/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type { TimelineState, TimelineActions } from './timeline-contract';
export { useTimelineStore } from './timeline-contract';
