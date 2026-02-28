import { useState, useCallback, useRef } from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/shared/ui/cn';

type MixedValue = number | 'mixed';

// Throttle interval for live changes to prevent overwhelming composition re-renders
const LIVE_CHANGE_THROTTLE_MS = 16; // ~60fps max

interface SliderInputProps {
  value: MixedValue;
  /** Called on final commit (mouse up). Updates the actual value. */
  onChange: (value: number) => void;
  /** Called during drag for live preview. If not provided, onChange is used. */
  onLiveChange?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/**
 * Slider with value display on the right side.
 * Supports custom formatting, 'mixed' state, and live preview.
 *
 * - onLiveChange: Called during drag (for preview, doesn't trigger re-render)
 * - onChange: Called on commit (mouse up, commits to store)
 */
export function SliderInput({
  value,
  onChange,
  onLiveChange,
  min,
  max,
  step = 1,
  unit,
  formatValue,
  disabled = false,
  className,
}: SliderInputProps) {
  const isMixed = value === 'mixed';
  const numericValue = isMixed ? (min + max) / 2 : value;

  // Track local value during drag for display
  const [localValue, setLocalValue] = useState<number | null>(null);
  const displayNumericValue = localValue ?? numericValue;

  // Throttle live change calls
  const lastLiveChangeRef = useRef<number>(0);

  const displayValue = isMixed && localValue === null
    ? 'Mixed'
    : formatValue
      ? formatValue(displayNumericValue)
      : `${displayNumericValue}${unit || ''}`;

  // Handle value change during drag - throttled to prevent overwhelming composition
  const handleValueChange = useCallback((values: number[]) => {
    const newValue = values[0]!;
    setLocalValue(newValue);
    if (onLiveChange) {
      const now = performance.now();
      if (now - lastLiveChangeRef.current >= LIVE_CHANGE_THROTTLE_MS) {
        lastLiveChangeRef.current = now;
        onLiveChange(newValue);
      }
    }
  }, [onLiveChange]);

  // Handle commit (mouse up) - blur to release focus for keyboard shortcuts
  const handleValueCommit = useCallback((values: number[]) => {
    const newValue = values[0]!;
    setLocalValue(null);
    onChange(newValue);
    // Blur slider to release focus for keyboard shortcuts (undo/redo)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [onChange]);

  return (
    <div className={cn('flex items-center gap-1 min-w-0 flex-1', className)}>
      <Slider
        value={[displayNumericValue]}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn('flex-1 min-w-0', isMixed && localValue === null && 'opacity-50')}
      />
      <span
        className={cn(
          'text-xs font-mono text-muted-foreground min-w-[52px] text-right flex-shrink-0',
          isMixed && localValue === null && 'italic'
        )}
      >
        {displayValue}
      </span>
    </div>
  );
}

