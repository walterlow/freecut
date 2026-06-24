import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { RotateCcw } from 'lucide-react'
import { HexColorPicker } from 'react-colorful'
import { Button } from '@/components/ui/button'
import { PropertyRow } from './property-row'

const NON_HEX_CHARS = /[^0-9a-fA-F]/g

/** Strip the leading `#` and any non-hex chars, capped at 6 digits. */
function normalizeHexDraft(color: string): string {
  return color.startsWith('#') ? color.slice(1).replace(NON_HEX_CHARS, '').slice(0, 6) : ''
}

/** react-colorful accepts 3- or 6-digit hex. */
function isCompleteHex(draft: string): boolean {
  return draft.length === 3 || draft.length === 6
}

interface HexInputProps {
  /** Current color (live), used to seed/sync the draft when not focused */
  color: string
  /** Fires on every complete-hex keystroke for live preview */
  onLiveChange: (color: string) => void
  /** Fires on blur / Enter to commit */
  onCommit: (color: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Editable hex field backed by its own local draft state. Decoupling the draft
 * from the live `color` prop lets the value update the color live (per keystroke)
 * without the parent's live updates resetting what the user is typing.
 */
function HexInput({ color, onLiveChange, onCommit, disabled, className }: HexInputProps) {
  const [draft, setDraft] = useState(() => normalizeHexDraft(color))
  const isFocusedRef = useRef(false)
  // Set when Enter/Escape blurs the input itself, so the resulting onBlur skips
  // its commit: Enter already committed (avoid a duplicate onChange) and Escape
  // reset the draft (committing would persist the stale typed value).
  const skipBlurCommitRef = useRef(false)

  // Sync the draft to external color changes only while the user isn't typing.
  useEffect(() => {
    if (!isFocusedRef.current) setDraft(normalizeHexDraft(color))
  }, [color])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(NON_HEX_CHARS, '').slice(0, 6)
      setDraft(next)
      if (isCompleteHex(next)) onLiveChange(`#${next}`)
    },
    [onLiveChange],
  )

  const commit = useCallback(() => {
    if (isCompleteHex(draft)) onCommit(`#${draft}`)
    else setDraft(normalizeHexDraft(color)) // revert incomplete input
  }, [draft, color, onCommit])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
        skipBlurCommitRef.current = true
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        setDraft(normalizeHexDraft(color))
        skipBlurCommitRef.current = true
        e.currentTarget.blur()
      }
    },
    [commit, color],
  )

  return (
    <input
      type="text"
      value={draft}
      onChange={handleChange}
      onFocus={() => {
        isFocusedRef.current = true
      }}
      onBlur={() => {
        isFocusedRef.current = false
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="characters"
      autoComplete="off"
      className={className}
    />
  )
}

interface ColorPickerProps {
  /** Current color value (hex or oklch format) */
  color: string
  /** Called when color is committed (picker closed) */
  onChange: (color: string) => void
  /** Called during drag for live preview */
  onLiveChange?: (color: string) => void
  /** Optional reset handler */
  onReset?: () => void
  /** Default color for reset comparison */
  defaultColor?: string
  /** Disable the picker */
  disabled?: boolean
  /** Preset color swatches to show */
  presets?: string[]
  /** Label for PropertyRow wrapper (omit for inline mode) */
  label?: string
}

/**
 * Unified color picker component.
 * - Supports live preview during drag via onLiveChange
 * - Supports preset color swatches
 * - Supports reset to default
 * - Can be used inline (no label) or wrapped in PropertyRow (with label)
 */
export const ColorPicker = memo(function ColorPicker({
  color,
  onChange,
  onLiveChange,
  onReset,
  defaultColor,
  disabled,
  presets,
  label,
}: ColorPickerProps) {
  const [localColor, setLocalColor] = useState(color)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync local state when color prop changes
  useEffect(() => {
    setLocalColor(color)
  }, [color])

  const handleColorChange = useCallback(
    (newColor: string) => {
      setLocalColor(newColor)
      onLiveChange?.(newColor)
    },
    [onLiveChange],
  )

  const handleCommit = useCallback(() => {
    onChange(localColor)
  }, [localColor, onChange])

  // Commit a specific value (from the hex field) and keep local state in sync.
  const commitColor = useCallback(
    (newColor: string) => {
      setLocalColor(newColor)
      onChange(newColor)
    },
    [onChange],
  )

  const handleClose = useCallback(() => {
    handleCommit()
    setIsOpen(false)
  }, [handleCommit])

  const handlePresetClick = useCallback(
    (preset: string) => {
      setLocalColor(preset)
      onChange(preset)
    },
    [onChange],
  )

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, handleClose])

  const pickerContent = (
    <div ref={containerRef} className="relative flex items-center gap-1 w-full">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex-shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        disabled={disabled}
        title="Open color picker"
      >
        <div
          className="w-6 h-6 rounded border border-border"
          style={{ backgroundColor: localColor }}
        />
      </button>
      <label
        className={`flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 py-0.5 text-xs font-mono uppercase hover:bg-muted/40 focus-within:bg-muted/60 focus-within:ring-1 focus-within:ring-ring ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="text-muted-foreground select-none">#</span>
        <HexInput
          color={localColor}
          onLiveChange={handleColorChange}
          onCommit={commitColor}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent uppercase text-foreground outline-none"
        />
      </label>

      {onReset && defaultColor && color !== defaultColor && !disabled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={onReset}
          title="Reset"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      )}

      {isOpen && !disabled && (
        <div className="absolute top-8 left-0 z-50 p-2 bg-popover border border-border rounded-lg shadow-lg">
          {/* Preset color swatches */}
          {presets && presets.length > 0 && (
            <div className="flex gap-1 mb-2">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className="w-6 h-6 rounded border border-border hover:ring-1 hover:ring-ring transition-[transform,box-shadow] duration-150 active:scale-90"
                  style={{ backgroundColor: preset }}
                  title={preset}
                />
              ))}
            </div>
          )}
          {/* Full color picker */}
          <HexColorPicker color={localColor} onChange={handleColorChange} />
          {/* Editable hex field */}
          <label className="mt-2 flex items-center gap-0.5 bg-input border border-border rounded px-2 py-1 text-xs font-mono uppercase focus-within:ring-1 focus-within:ring-ring">
            <span className="text-muted-foreground select-none">#</span>
            <HexInput
              color={localColor}
              onLiveChange={handleColorChange}
              onCommit={commitColor}
              className="min-w-0 flex-1 bg-transparent uppercase text-foreground outline-none"
            />
          </label>
        </div>
      )}
    </div>
  )

  // If label provided, wrap in PropertyRow; otherwise render inline
  if (label) {
    return <PropertyRow label={label}>{pickerContent}</PropertyRow>
  }

  return pickerContent
})
