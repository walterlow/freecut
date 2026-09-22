import { memo, type RefObject } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import type { AudioFadeHandle } from '../../utils/audio-fade'
import { AUDIO_ENVELOPE_VIEWBOX_HEIGHT } from './timeline-item-css-vars'
import { AudioFadeHandles } from './audio-fade-handles'
import { AudioVolumeControl } from './audio-volume-control'
import { VideoFadeHandles } from './video-fade-handles'
import type {
  AudioFadeCurveEditState,
  AudioFadeEditState,
  AudioVolumeEditState,
  VideoFadeEditState,
} from './use-fade-editors'
import type { FadeMath } from './use-fade-math'

const FADE_VIEWBOX_WIDTH = 1000

interface FadeEnvelopeOverlayProps {
  itemType: TimelineItemType['type']
  isVisualFadeItem: boolean
  videoControlsRef: RefObject<HTMLDivElement | null>
  audioControlsRef: RefObject<HTMLDivElement | null>
  volumeLineRef: RefObject<HTMLDivElement | null>
  videoFadeInRatio: number
  videoFadeOutRatio: number
  videoFadeInPath: string
  videoFadeOutPath: string
  audioFadeInRatio: number
  audioFadeOutRatio: number
  audioFadeInCurvePath: string
  audioFadeOutCurvePath: string
  audioVolumeLineYPercent: number
  audioVolumeLineStroke: string
}

/** Fade/envelope backdrops drawn behind the clip content. */
export const FadeEnvelopeOverlay = memo(function FadeEnvelopeOverlay({
  itemType,
  isVisualFadeItem,
  videoControlsRef,
  audioControlsRef,
  volumeLineRef,
  videoFadeInRatio,
  videoFadeOutRatio,
  videoFadeInPath,
  videoFadeOutPath,
  audioFadeInRatio,
  audioFadeOutRatio,
  audioFadeInCurvePath,
  audioFadeOutCurvePath,
  audioVolumeLineYPercent,
  audioVolumeLineStroke,
}: FadeEnvelopeOverlayProps) {
  return (
    <>
      {isVisualFadeItem && (
        <div
          ref={videoControlsRef}
          className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
          style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${FADE_VIEWBOX_WIDTH} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
          >
            {videoFadeInRatio > 0 && <path d={videoFadeInPath} fill="rgba(15,23,42,0.46)" />}
            {videoFadeOutRatio > 0 && <path d={videoFadeOutPath} fill="rgba(15,23,42,0.46)" />}
          </svg>
        </div>
      )}

      {itemType === 'audio' && (
        <div
          ref={audioControlsRef}
          className="absolute inset-x-0 bottom-0 pointer-events-none z-10"
          style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
        >
          <div
            ref={volumeLineRef}
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              height: '1px',
              top: `var(--timeline-audio-volume-line-y, ${audioVolumeLineYPercent}%)`,
              backgroundColor: audioVolumeLineStroke,
            }}
          />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${FADE_VIEWBOX_WIDTH} ${AUDIO_ENVELOPE_VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
          >
            {audioFadeInRatio > 0 && <path d={audioFadeInCurvePath} fill="rgba(0,0,0,0.5)" />}
            {audioFadeOutRatio > 0 && <path d={audioFadeOutCurvePath} fill="rgba(0,0,0,0.5)" />}
          </svg>
        </div>
      )}
    </>
  )
})

interface VideoFadeHandleLayerProps {
  isVisualFadeItem: boolean
  trackLocked: boolean
  activeTool: string
  lineYPercent: number
  fadeInRatio: number
  fadeOutRatio: number
  isSelected: boolean
  videoFadeEdit: VideoFadeEditState | null
  fadeInLabel: string
  fadeOutLabel: string
  onFadeHandleMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  onFadeHandleDoubleClick: (handle: AudioFadeHandle) => void
}

/** Video fade drag handles. */
export const VideoFadeHandleLayer = memo(function VideoFadeHandleLayer({
  isVisualFadeItem,
  trackLocked,
  activeTool,
  lineYPercent,
  fadeInRatio,
  fadeOutRatio,
  isSelected,
  videoFadeEdit,
  fadeInLabel,
  fadeOutLabel,
  onFadeHandleMouseDown,
  onFadeHandleDoubleClick,
}: VideoFadeHandleLayerProps) {
  if (!isVisualFadeItem) return null

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 pointer-events-none"
      style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
    >
      <VideoFadeHandles
        trackLocked={trackLocked}
        activeTool={activeTool}
        lineYPercent={lineYPercent}
        fadeInPercent={fadeInRatio * 100}
        fadeOutPercent={fadeOutRatio * 100}
        isSelected={isSelected}
        isEditing={videoFadeEdit !== null}
        editingHandle={videoFadeEdit?.handle ?? null}
        fadeInLabel={fadeInLabel}
        fadeOutLabel={fadeOutLabel}
        onFadeHandleMouseDown={onFadeHandleMouseDown}
        onFadeHandleDoubleClick={onFadeHandleDoubleClick}
      />
    </div>
  )
})

interface AudioFadeHandleLayerProps {
  itemType: TimelineItemType['type']
  trackLocked: boolean
  activeTool: string
  lineYPercent: number
  fadeInRatio: number
  fadeOutRatio: number
  isSelected: boolean
  audioFadeEdit: AudioFadeEditState | null
  audioFadeCurveEdit: AudioFadeCurveEditState | null
  audioVolumeEdit: AudioVolumeEditState | null
  fadeInLabel: string
  fadeOutLabel: string
  fadeInCurvePoint: FadeMath['audioFadeInCurvePoint']
  fadeOutCurvePoint: FadeMath['audioFadeOutCurvePoint']
  volumeEditLabel: string | null
  volumeEditLabelRef: RefObject<HTMLElement | null>
  onFadeHandleMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  onFadeHandleDoubleClick: (handle: AudioFadeHandle) => void
  onFadeCurveDotMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void
  onFadeCurveDotDoubleClick: (handle: AudioFadeHandle) => void
  onVolumeMouseDown: (e: React.MouseEvent) => void
  onVolumeDoubleClick: () => void
}

/** Audio fade handles, envelope curve dots and the volume control. */
export const AudioFadeHandleLayer = memo(function AudioFadeHandleLayer({
  itemType,
  trackLocked,
  activeTool,
  lineYPercent,
  fadeInRatio,
  fadeOutRatio,
  isSelected,
  audioFadeEdit,
  audioFadeCurveEdit,
  audioVolumeEdit,
  fadeInLabel,
  fadeOutLabel,
  fadeInCurvePoint,
  fadeOutCurvePoint,
  volumeEditLabel,
  volumeEditLabelRef,
  onFadeHandleMouseDown,
  onFadeHandleDoubleClick,
  onFadeCurveDotMouseDown,
  onFadeCurveDotDoubleClick,
  onVolumeMouseDown,
  onVolumeDoubleClick,
}: AudioFadeHandleLayerProps) {
  if (itemType !== 'audio') return null

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 pointer-events-none"
      style={{ top: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
    >
      <AudioFadeHandles
        trackLocked={trackLocked}
        activeTool={activeTool}
        lineYPercent={lineYPercent}
        fadeInPercent={fadeInRatio * 100}
        fadeOutPercent={fadeOutRatio * 100}
        isSelected={isSelected}
        isEditing={audioFadeEdit !== null}
        editingHandle={audioFadeEdit?.handle ?? null}
        curveEditingHandle={audioFadeCurveEdit?.handle ?? null}
        fadeInLabel={fadeInLabel}
        fadeOutLabel={fadeOutLabel}
        fadeInCurveDot={
          fadeInRatio > 0 && fadeInCurvePoint
            ? {
                xPercent: (fadeInCurvePoint.x / FADE_VIEWBOX_WIDTH) * 100,
                yPercent: fadeInCurvePoint.y,
              }
            : null
        }
        fadeOutCurveDot={
          fadeOutRatio > 0 && fadeOutCurvePoint
            ? {
                xPercent: (fadeOutCurvePoint.x / FADE_VIEWBOX_WIDTH) * 100,
                yPercent: fadeOutCurvePoint.y,
              }
            : null
        }
        onFadeHandleMouseDown={onFadeHandleMouseDown}
        onFadeHandleDoubleClick={onFadeHandleDoubleClick}
        onFadeCurveDotMouseDown={onFadeCurveDotMouseDown}
        onFadeCurveDotDoubleClick={onFadeCurveDotDoubleClick}
      />
      <AudioVolumeControl
        trackLocked={trackLocked}
        activeTool={activeTool}
        lineYPercent={lineYPercent}
        isEditing={audioVolumeEdit !== null}
        editLabel={volumeEditLabel}
        editLabelRef={volumeEditLabelRef}
        onVolumeMouseDown={onVolumeMouseDown}
        onVolumeDoubleClick={onVolumeDoubleClick}
      />
    </div>
  )
})
