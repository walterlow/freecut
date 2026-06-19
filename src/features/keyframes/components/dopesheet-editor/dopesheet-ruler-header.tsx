import { useTranslation } from 'react-i18next'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { RULER_HEIGHT } from './dopesheet-constants'

interface DopesheetRulerHeaderProps {
  propertyGridStyle: CSSProperties
  timelineRef: React.RefObject<HTMLDivElement | null>
  onRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  rulerTickElements: ReactNode
  /** Self-positioning playhead flag handle, rendered over the ruler ticks. */
  playheadFlag?: ReactNode
}

export function DopesheetRulerHeader({
  propertyGridStyle,
  timelineRef,
  onRulerPointerDown,
  onRulerPointerMove,
  onRulerPointerUp,
  rulerTickElements,
  playheadFlag,
}: DopesheetRulerHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
      <div
        className="px-1 flex items-center text-[10px] font-medium text-muted-foreground"
        style={{ height: RULER_HEIGHT }}
      >
        {t('timeline.keyframeEditor.property')}
      </div>
      <div
        data-testid="dopesheet-ruler"
        ref={timelineRef}
        className="relative border-l border-border cursor-ew-resize overflow-x-clip"
        style={{ height: RULER_HEIGHT }}
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
        onPointerUp={onRulerPointerUp}
        onPointerCancel={onRulerPointerUp}
      >
        {rulerTickElements}
        {playheadFlag}
      </div>
    </div>
  )
}
