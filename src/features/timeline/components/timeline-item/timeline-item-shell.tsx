import { memo, type CSSProperties, type DragEventHandler, type ReactNode, type RefObject } from 'react'
import { cn } from '@/shared/ui/cn'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { EffectDropOverlay } from './effect-drop-overlay'
import { getTimelineItemShellStyle } from './get-shell-style'
import {
  getAudioVolumeCssVars,
  type AudioVolumeCssVarsParams,
} from './timeline-item-css-vars'
import { getFramePositionStyle } from './timeline-item-geometry'
import type { ContextMenuState } from './use-context-menu-state'
import type { SmartTrimHoverHandle } from './use-smart-trim-hover'
import type { TimelineItemPointerHandlers } from './use-timeline-item-pointer-handlers'

interface TimelineItemShellProps {
  transformRef: RefObject<HTMLDivElement | null>
  itemId: string
  itemType: TimelineItemType['type']
  fps: number
  visualLeftFrame: number
  visualWidthFrames: number
  isSelected: boolean
  isCompactShell: boolean
  isBeingDragged: boolean
  isStretching: boolean
  isAltDrag: boolean
  isDragging: boolean
  dragOffset: { x: number; y: number }
  shouldDimForDrag: boolean
  trackHidden: boolean
  trackLocked: boolean
  itemColorClasses: string | undefined
  cursorClass: string
  audioVolumeEdit: AudioVolumeCssVarsParams['audioVolumeEdit']
  audioVolumePreviewRef: AudioVolumeCssVarsParams['audioVolumePreviewRef']
  audioVolumeLineYPercent: number
  audioVisualizationScale: number
  isEffectDropTarget: boolean
  multiEffectDropTargetCount: number
  onHoverChange?: (itemId: string, hovered: boolean) => void
  onClick: TimelineItemPointerHandlers['handleClick']
  onDoubleClick: TimelineItemPointerHandlers['handleDoubleClick']
  onMouseDown: TimelineItemPointerHandlers['handleMouseDown']
  onMouseMove: SmartTrimHoverHandle['handleMouseMove']
  onMouseLeave: SmartTrimHoverHandle['handleMouseLeave']
  onContextMenu: ContextMenuState['handleContextMenu']
  onDragEnter: DragEventHandler<HTMLDivElement>
  onDragOver: DragEventHandler<HTMLDivElement>
  onDragLeave: DragEventHandler<HTMLDivElement>
  onDrop: DragEventHandler<HTMLDivElement>
  children: ReactNode
}

/**
 * The clip's positioned, styled and interactive shell: the absolutely placed
 * box that carries the item's geometry, selection/compact data attributes,
 * drag transform and pointer/drag handlers, plus the layers that must sit
 * above the clip body (selection ring, effect-drop overlay).
 */
export const TimelineItemShell = memo(function TimelineItemShell({
  transformRef,
  itemId,
  itemType,
  fps,
  visualLeftFrame,
  visualWidthFrames,
  isSelected,
  isCompactShell,
  isBeingDragged,
  isStretching,
  isAltDrag,
  isDragging,
  dragOffset,
  shouldDimForDrag,
  trackHidden,
  trackLocked,
  itemColorClasses,
  cursorClass,
  audioVolumeEdit,
  audioVolumePreviewRef,
  audioVolumeLineYPercent,
  audioVisualizationScale,
  isEffectDropTarget,
  multiEffectDropTargetCount,
  onHoverChange,
  onClick,
  onDoubleClick,
  onMouseDown,
  onMouseMove,
  onMouseLeave,
  onContextMenu,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: TimelineItemShellProps) {
  return (
    <div
      ref={transformRef}
      data-timeline-item
      data-item-id={itemId}
      data-timeline-start-frame={visualLeftFrame}
      data-timeline-duration-frames={visualWidthFrames}
      data-timeline-fps={fps}
      data-timeline-content-inset-start-px={1}
      data-timeline-content-inset-end-px={1}
      data-selected={isSelected ? 'true' : undefined}
      data-compact-clip={isCompactShell ? 'true' : undefined}
      className={cn(
        'timeline-item @container absolute inset-y-px rounded overflow-visible group/timeline-item',
        itemColorClasses,
        cursorClass,
        !isBeingDragged && !isStretching && !trackLocked && 'hover:brightness-110',
      )}
      style={
        {
          left: getFramePositionStyle(visualLeftFrame),
          width: getFramePositionStyle(visualWidthFrames),
          ...getTimelineItemShellStyle({
            itemId,
            isBeingDragged,
            isAltDrag,
            isDragging,
            dragOffset,
            shouldDimForDrag,
            trackHidden,
            trackLocked,
            isCompactShell,
          }),
          ...getAudioVolumeCssVars({
            itemType,
            audioVolumeEdit,
            audioVolumePreviewRef,
            audioVolumeLineYPercent,
            audioVisualizationScale,
          }),
        } as CSSProperties
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onMouseEnter={() => onHoverChange?.(itemId, true)}
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        onMouseLeave()
        onHoverChange?.(itemId, false)
      }}
      onContextMenu={onContextMenu}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Keep selection visible throughout drag so the moving cohort stays legible. */}
      {isSelected && !trackLocked && (
        <div className="timeline-selection-indicator absolute inset-0 rounded pointer-events-none z-20 border border-primary" />
      )}

      {isEffectDropTarget && <EffectDropOverlay multiDropCount={multiEffectDropTargetCount} />}

      {children}
    </div>
  )
})
