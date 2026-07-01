import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2Off, Diamond, Waves } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'

interface ClipIndicatorsProps {
  /** Whether the item has keyframe animations */
  hasKeyframes: boolean
  /** Whether the item has procedural motion (modulators / audio pulse) */
  hasMotion: boolean
  /** Current playback speed (1 = normal) */
  currentSpeed: number
  /** Whether media playback is reversed */
  isReversed: boolean
  reverseConformStatus?: 'pending' | 'ready' | 'error'
  /** Whether the item is currently being rate stretched */
  isStretching: boolean
  /** Visual feedback during stretch (speed preview) */
  stretchFeedback: { speed: number } | null
  /** Whether the item's media is broken/missing */
  isBroken: boolean
  /** Whether the item has a mediaId */
  hasMediaId: boolean
  /** Whether the item is a shape configured as a mask */
  isMask: boolean
  /** Whether the item is a shape */
  isShape: boolean
}

/**
 * Renders status indicators/badges on timeline clips:
 * - Keyframe diamond icon (amber)
 * - Speed badge when not 1x (shows current or preview speed)
 * - Broken media indicator (red link-off icon)
 * - Mask badge for shape items
 */
export const ClipIndicators = memo(function ClipIndicators({
  hasKeyframes,
  hasMotion,
  currentSpeed,
  isReversed,
  reverseConformStatus,
  isStretching,
  stretchFeedback,
  isBroken,
  hasMediaId,
  isMask,
  isShape,
}: ClipIndicatorsProps) {
  const { t } = useTranslation()
  const showSpeedBadge = Math.abs(currentSpeed - 1) > 0.005 && !isStretching

  return (
    <>
      {/* Label-row badges ââ‚¬” single container to prevent overlap */}
      {(hasKeyframes ||
        hasMotion ||
        (isShape && isMask) ||
        showSpeedBadge ||
        isReversed ||
        reverseConformStatus === 'pending' ||
        reverseConformStatus === 'error') && (
        <div
          className="absolute right-1 z-10 pointer-events-none flex items-center gap-1"
          style={{ top: 0, height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight }}
        >
          {hasKeyframes && (
            <span title={t('timeline.clipIndicators.hasKeyframes')}>
              <Diamond className="w-3 h-3 text-amber-500 fill-amber-500/50" />
            </span>
          )}
          {hasMotion && (
            <span title={t('timeline.clipIndicators.hasMotion')}>
              <Waves className="w-3 h-3 text-sky-400" />
            </span>
          )}
          {isShape && isMask && (
            <span
              className="px-1 py-0.5 text-[10px] font-bold bg-cyan-500/80 text-white rounded"
              title={t('timeline.clipIndicators.mask')}
            >
              M
            </span>
          )}
          {showSpeedBadge && (
            <span
              className="px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono"
              title={t('timeline.clipIndicators.speed', { speed: currentSpeed.toFixed(2) })}
            >
              {currentSpeed.toFixed(2)}x
            </span>
          )}
          {isReversed && (
            <span
              className="px-1 py-0.5 text-[10px] font-bold bg-black/60 text-white rounded font-mono"
              title={
                reverseConformStatus === 'ready'
                  ? t('timeline.clipIndicators.reversedPrepared')
                  : reverseConformStatus === 'pending'
                    ? t('timeline.clipIndicators.preparingReversed')
                    : reverseConformStatus === 'error'
                      ? t('timeline.clipIndicators.reversedPrepFailed')
                      : t('timeline.clipIndicators.reversedPlayback')
              }
            >
              REV
            </span>
          )}
          {reverseConformStatus === 'pending' && (
            <span
              className="px-1 py-0.5 text-[10px] font-bold bg-sky-600/80 text-white rounded font-mono"
              title={t('timeline.clipIndicators.preparingReversed')}
            >
              PREP
            </span>
          )}
          {reverseConformStatus === 'error' && (
            <span
              className="px-1 py-0.5 text-[10px] font-bold bg-red-600/80 text-white rounded font-mono"
              title={t('timeline.clipIndicators.reversePrepFailedShort')}
            >
              ERR
            </span>
          )}
        </div>
      )}

      {/* Missing media indicator */}
      {isBroken && hasMediaId && (
        <div
          className="absolute bottom-1 right-1 p-0.5 rounded bg-destructive/90 text-destructive-foreground"
          title={t('timeline.clipIndicators.mediaMissing')}
        >
          <Link2Off className="w-3 h-3" />
        </div>
      )}

      {/* Preview speed overlay during stretch */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none z-10 transition-opacity duration-75',
          isStretching && stretchFeedback ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="text-white font-mono text-sm font-bold">
          {stretchFeedback?.speed.toFixed(2) ?? '1.00'}x
        </span>
      </div>
    </>
  )
})
