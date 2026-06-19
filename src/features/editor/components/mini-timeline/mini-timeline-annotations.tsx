import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  TimelineAnnotationMarker,
  TimelineAnnotationModel,
} from '@/shared/timeline/timeline-annotations'

/**
 * Track-spanning annotations for the mini timeline: clickable marker flags over
 * the ruler + track rows. The IO range strip + handles live in
 * {@link MiniTimelineIoLane}; the in/out guide lines are intentionally not drawn
 * here so the rows stay uncluttered.
 */
export const MiniTimelineAnnotations = memo(function MiniTimelineAnnotations({
  model,
  selectedMarkerId,
  onMarkerPress,
  labelWidth,
  testIdPrefix,
}: {
  model: TimelineAnnotationModel
  selectedMarkerId: string | null
  onMarkerPress: (marker: TimelineAnnotationMarker) => void
  labelWidth: number
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 top-0"
      data-testid={`${testIdPrefix}-annotations`}
      style={{ left: labelWidth }}
    >
      {model.markers.map((marker) => {
        const selected = selectedMarkerId === marker.id
        return (
          <button
            key={marker.id}
            type="button"
            className="pointer-events-auto absolute bottom-0 top-0 z-[14] w-5 -translate-x-1/2 cursor-pointer"
            data-testid={`${testIdPrefix}-marker`}
            data-marker-id={marker.id}
            style={{ left: `${marker.positionRatio * 100}%` }}
            title={marker.label || t('editor.miniTimeline.markerAtFrame', { frame: marker.frame })}
            aria-label={
              marker.label || t('editor.miniTimeline.markerAtFrame', { frame: marker.frame })
            }
            onPointerDown={(event) => {
              event.stopPropagation()
              if (event.button !== 0) return
              onMarkerPress(marker)
            }}
            onClick={(event) => {
              event.stopPropagation()
              // Mouse clicks are already handled by onPointerDown; only act on
              // keyboard activation (Enter/Space), which has detail === 0.
              if (event.detail !== 0) return
              onMarkerPress(marker)
            }}
          >
            <span
              className={`absolute bottom-0 top-4 left-1/2 w-px -translate-x-1/2 ${
                selected ? 'bg-white' : 'bg-white/45'
              }`}
              aria-hidden="true"
            />
            <span
              className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent drop-shadow"
              style={{ borderTopColor: selected ? '#ffffff' : marker.color }}
              aria-hidden="true"
            />
            {selected ? (
              <span
                className="absolute left-1/2 top-[2px] h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent"
                style={{ borderTopColor: marker.color }}
                aria-hidden="true"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
})
