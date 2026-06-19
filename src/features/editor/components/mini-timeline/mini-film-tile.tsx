import { memo, type CSSProperties, type ReactNode } from 'react'
import { MINI_FILM_TILE_HEIGHT, MINI_FILM_TILE_WIDTH } from './constants'

/**
 * Presentational film tile: numbered badge + timecode + track name header, a
 * thumbnail body, and a label footer. The Color workspace layers its baked-grade
 * thumbnail + grade indicator on top via `overlay`/`imageDataAttributes`; the
 * Animate workspace uses it bare. Selection/click behavior is delegated.
 */
export const MiniFilmTile = memo(function MiniFilmTile({
  index,
  label,
  trackName,
  timecodeText,
  thumbnailUrl,
  selected,
  onSelect,
  testId,
  dataClipId,
  imageStyle,
  imageDataAttributes,
  overlay,
}: {
  index: number
  label: string
  trackName: string
  timecodeText: string
  thumbnailUrl?: string
  selected: boolean
  onSelect: () => void
  testId?: string
  dataClipId?: string
  imageStyle?: CSSProperties
  imageDataAttributes?: Record<string, string | undefined>
  overlay?: ReactNode
}) {
  const clipNumber = String(index + 1).padStart(2, '0')

  return (
    <button
      type="button"
      data-testid={testId}
      data-clip-id={dataClipId}
      className={`group grid shrink-0 grid-rows-[20px_1fr_16px] overflow-hidden rounded-[3px] border bg-[#17181d] text-left shadow-sm transition-colors ${
        selected
          ? 'border-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.65)]'
          : 'border-zinc-700 hover:border-zinc-500'
      }`}
      style={{ width: MINI_FILM_TILE_WIDTH, height: MINI_FILM_TILE_HEIGHT }}
      onClick={(event) => {
        // Mouse clicks are already handled by onPointerDown; only act on
        // keyboard activation (Enter/Space), which fires click with detail === 0.
        if (event.detail !== 0) return
        onSelect()
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        onSelect()
      }}
      title={label}
    >
      <span className="flex min-w-0 items-center gap-1 border-b border-black/40 bg-[#24252b] px-1.5 text-[10px] font-semibold text-zinc-200">
        <span
          className={`rounded-[2px] border px-1 leading-3 ${
            selected
              ? 'border-lime-300/80 bg-indigo-700 text-lime-200'
              : 'border-indigo-400/70 bg-zinc-800 text-zinc-200'
          }`}
        >
          {clipNumber}
        </span>
        <span className="font-mono">{timecodeText}</span>
        <span className="ml-auto text-[9px] text-zinc-400">{trackName}</span>
      </span>

      <span className="relative block min-h-0 overflow-hidden bg-black">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            style={imageStyle}
            {...imageDataAttributes}
          />
        ) : (
          <span className="block h-full w-full bg-black" style={imageStyle} />
        )}
        {overlay}
      </span>

      <span className="truncate border-t border-black/40 bg-[#202127] px-1.5 text-[10px] font-medium text-zinc-300">
        {label}
      </span>
    </button>
  )
})
