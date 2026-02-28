import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Button } from '@/components/ui/button';
import { PropertyRow } from './property-row';

interface ColorPickerProps {
  /** Current color value (hex or oklch format) */
  color: string;
  /** Called when color is committed (picker closed) */
  onChange: (color: string) => void;
  /** Called during drag for live preview */
  onLiveChange?: (color: string) => void;
  /** Optional reset handler */
  onReset?: () => void;
  /** Default color for reset comparison */
  defaultColor?: string;
  /** Disable the picker */
  disabled?: boolean;
  /** Preset color swatches to show */
  presets?: string[];
  /** Label for PropertyRow wrapper (omit for inline mode) */
  label?: string;
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
  const [localColor, setLocalColor] = useState(color);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync local state when color prop changes
  useEffect(() => {
    setLocalColor(color);
  }, [color]);

  const handleColorChange = useCallback(
    (newColor: string) => {
      setLocalColor(newColor);
      onLiveChange?.(newColor);
    },
    [onLiveChange]
  );

  const handleCommit = useCallback(() => {
    onChange(localColor);
  }, [localColor, onChange]);

  const handleClose = useCallback(() => {
    handleCommit();
    setIsOpen(false);
  }, [handleCommit]);

  const handlePresetClick = useCallback(
    (preset: string) => {
      setLocalColor(preset);
      onChange(preset);
    },
    [onChange]
  );

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleClose]);

  const pickerContent = (
    <div ref={containerRef} className="relative flex items-center gap-1 w-full">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex items-center gap-2 flex-1 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        disabled={disabled}
      >
        <div
          className="w-6 h-6 rounded border border-border flex-shrink-0"
          style={{ backgroundColor: localColor }}
        />
        <span className="text-xs font-mono text-muted-foreground uppercase">
          {localColor}
        </span>
      </button>

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
                  className="w-6 h-6 rounded border border-border hover:ring-1 hover:ring-ring transition-all"
                  style={{ backgroundColor: preset }}
                  title={preset}
                />
              ))}
            </div>
          )}
          {/* Full color picker */}
          <HexColorPicker color={localColor} onChange={handleColorChange} />
        </div>
      )}
    </div>
  );

  // If label provided, wrap in PropertyRow; otherwise render inline
  if (label) {
    return <PropertyRow label={label}>{pickerContent}</PropertyRow>;
  }

  return pickerContent;
});
