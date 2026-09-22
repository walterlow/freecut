import { memo } from 'react'

interface EffectDropOverlayProps {
  multiDropCount: number
}

export const EffectDropOverlay = memo(function EffectDropOverlay({
  multiDropCount,
}: EffectDropOverlayProps) {
  return (
    <div className="absolute inset-0 rounded pointer-events-none z-20 border border-dashed border-sky-300/90 bg-sky-400/15 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)]">
      {multiDropCount > 1 && (
        <div className="absolute top-1 right-1 rounded-full bg-sky-300/90 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-950">
          {multiDropCount} clips
        </div>
      )}
    </div>
  )
})
