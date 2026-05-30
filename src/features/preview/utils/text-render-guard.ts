import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineTrack } from '@/types/timeline'

function hasVisibleStyledText(track: TimelineTrack): boolean {
  if (!track.visible) return false

  for (const item of track.items) {
    if (item.type !== 'text') continue

    // Generated captions always render via the Player during scrub.
    const isGeneratedCaption = item.textRole === 'caption' || item.captionSource !== undefined
    if (isGeneratedCaption) return true

    // Styled text (shadow or stroke) rasterizes subtly differently on the 2D
    // canvas fast-scrub path (fillText/strokeText at project resolution, then
    // downscaled) than via the DOM/CSS path used at rest — the baseline metric,
    // the downscale resample, and stroke anti-aliasing all diverge. A static
    // title would "pop" vertically when entering/leaving scrub. Keep it on the
    // Player during scrub so skim and rest share one renderer. Animation is no
    // longer required — static styled text needs unifying too.
    const hasStyledText = !!item.textShadow || (item.stroke?.width ?? 0) > 0
    if (hasStyledText) return true
  }

  return false
}

/**
 * Whether the preview should render via the DOM Player instead of the 2D-canvas
 * fast-scrub overlay while scrubbing, so styled text / captions don't shift
 * between the two text renderers.
 *
 * `_keyframes` is retained for call-site compatibility; it no longer affects
 * the result (animation used to gate this, but static styled text diverges too).
 */
export function shouldPreferPlayerForStyledTextScrub(
  tracks: TimelineTrack[],
  _keyframes?: ItemKeyframes[],
): boolean {
  return tracks.some(hasVisibleStyledText)
}
