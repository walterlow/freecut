import { memo, type CSSProperties } from 'react'
import { cn } from '@/shared/ui/cn'
import type { MotionThumbnail } from '@/features/editor/deps/keyframes'
import './motion-preset-thumbnail.css'

const KIND_CLASS: Record<Exclude<MotionThumbnail['kind'], 'scale'>, string> = {
  fade: 'mp-fade',
  slide: 'mp-slide',
  spin: 'mp-spin',
  bounce: 'mp-bounce',
  pulse: 'mp-pulse',
  shake: 'mp-shake',
  wobble: 'mp-wobble',
  wiggle: 'mp-wiggle',
  drift: 'mp-drift',
  'micro-shake': 'mp-micro-shake',
}

interface AngleStyle extends CSSProperties {
  '--mp-angle'?: string
}

/**
 * A small animated glyph that demonstrates a motion preset. The motion runs
 * only on hover (see the co-located CSS) so the full grid is idle at rest.
 */
export const MotionPresetThumbnail = memo(function MotionPresetThumbnail({
  thumbnail,
}: {
  thumbnail: MotionThumbnail
}) {
  const motionClass =
    thumbnail.kind === 'scale'
      ? thumbnail.direction === -1
        ? 'mp-scale-down'
        : 'mp-scale-up'
      : KIND_CLASS[thumbnail.kind]

  const style: AngleStyle | undefined =
    thumbnail.angle !== undefined ? { '--mp-angle': `${thumbnail.angle}deg` } : undefined

  return (
    <span className="mp-thumb text-foreground/80" aria-hidden>
      <span className={cn('mp-shape', motionClass)} style={style} />
    </span>
  )
})
