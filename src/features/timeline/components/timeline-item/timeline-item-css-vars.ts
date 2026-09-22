import type { CSSProperties, MutableRefObject } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { getAudioVisualizationScale, getAudioVolumeLineY } from '../../utils/audio-volume'
import type { AudioVolumeEditState } from './use-fade-editors'

export const AUDIO_ENVELOPE_VIEWBOX_HEIGHT = 100

export interface AudioVolumeCssVarsParams {
  itemType: TimelineItemType['type']
  audioVolumeEdit: AudioVolumeEditState | null
  audioVolumePreviewRef: MutableRefObject<number>
  audioVolumeLineYPercent: number
  audioVisualizationScale: number
}

/**
 * Audio envelope custom properties for the clip shell. While a volume drag is
 * live the preview ref is the source of truth (the store value lags the drag).
 */
export function getAudioVolumeCssVars({
  itemType,
  audioVolumeEdit,
  audioVolumePreviewRef,
  audioVolumeLineYPercent,
  audioVisualizationScale,
}: AudioVolumeCssVarsParams): CSSProperties {
  const isEditingVolume = itemType === 'audio' && audioVolumeEdit !== null

  return {
    '--timeline-audio-volume-line-y': `${
      isEditingVolume
        ? (getAudioVolumeLineY(audioVolumePreviewRef.current, AUDIO_ENVELOPE_VIEWBOX_HEIGHT) /
            AUDIO_ENVELOPE_VIEWBOX_HEIGHT) *
          100
        : audioVolumeLineYPercent
    }%`,
    '--timeline-audio-waveform-scale': String(
      isEditingVolume
        ? getAudioVisualizationScale(audioVolumePreviewRef.current)
        : audioVisualizationScale,
    ),
  } as CSSProperties
}
