import { EDITOR_LAYOUT } from '@/app/editor-layout';

const TIMELINE_CLIP_LABEL_ROW_HEIGHT_CSS_VAR = '--editor-timeline-clip-label-row-height';

export function getTimelineClipLabelRowHeightPx(element: Element): number {
  const rawValue = window.getComputedStyle(element)
    .getPropertyValue(TIMELINE_CLIP_LABEL_ROW_HEIGHT_CSS_VAR)
    .trim();
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue)
    ? parsedValue
    : EDITOR_LAYOUT.timelineClipLabelRowHeight;
}
