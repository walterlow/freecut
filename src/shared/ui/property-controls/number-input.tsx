import { useCallback, useRef, useState, useEffect } from 'react';
import { cn } from '@/shared/ui/cn';

type MixedValue = number | 'mixed';

interface NumberInputProps {
  value: MixedValue;
  /** Called on final commit (blur, enter, mouseup). Updates the actual value. */
  onChange: (value: number) => void;
  /** Called during scrub/drag for live preview. If not provided, onChange is used. */
  onLiveChange?: (value: number) => void;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  formatInputValue?: (value: number) => string;
  parseInputValue?: (rawValue: string) => number;
  disabled?: boolean;
  scrubEnabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Width of the unit suffix area - use consistent value across inputs for alignment */
  unitWidth?: number;
}

/**
 * Compact number input with optional label prefix and unit suffix.
 * Supports:
 * - Click-drag (scrub) to adjust value
 * - Arrow keys for increment/decrement
 * - Shift+Arrow for 10x step
 * - 'Mixed' state for multi-selection with different values
 */
export function NumberInput({
  value,
  onChange,
  onLiveChange,
  label,
  unit,
  min,
  max,
  step = 1,
  formatInputValue,
  parseInputValue,
  disabled = false,
  scrubEnabled = true,
  placeholder,
  className,
  unitWidth = 20,
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(() => {
    if (value === 'mixed') return '';
    if (step >= 1) return String(Math.round(value));
    return value.toFixed(2);
  });
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubStartRef = useRef<{ x: number; startValue: number } | null>(null);
  const scrubValueRef = useRef<number | null>(null);
  // Throttle live change calls to prevent overwhelming composition re-renders
  const lastLiveChangeRef = useRef<number>(0);
  const LIVE_CHANGE_THROTTLE_MS = 16; // ~60fps max

  const clamp = useCallback(
    (v: number) => {
      let result = v;
      if (min !== undefined) result = Math.max(min, result);
      if (max !== undefined) result = Math.min(max, result);
      return result;
    },
    [min, max]
  );

  // Format number for display (2 decimal places for decimal steps, integer for step=1)
  const formatValue = useCallback(
    (v: number) => {
      if (formatInputValue) return formatInputValue(v);
      if (step >= 1) return String(Math.round(v));
      return v.toFixed(2);
    },
    [formatInputValue, step]
  );

  const resetLocalValue = useCallback(() => {
    const nextValue = value === 'mixed' ? '' : formatValue(value);
    setLocalValue(nextValue);
  }, [value, formatValue]);

  const commitLocalValue = useCallback(
    (rawValue: string) => {
      const parsed = parseInputValue ? parseInputValue(rawValue) : parseFloat(rawValue);
      if (!isNaN(parsed)) {
        const committedValue = clamp(parsed);
        const formattedValue = formatValue(committedValue);
        setLocalValue(formattedValue);
        onChange(committedValue);
        return;
      }

      resetLocalValue();
    },
    [clamp, formatValue, onChange, parseInputValue, resetLocalValue]
  );

  // Sync local value with prop value
  useEffect(() => {
    if (!inputRef.current || document.activeElement !== inputRef.current) {
      const nextValue = value === 'mixed' ? '' : formatValue(value);
      setLocalValue(nextValue);
    }
  }, [value, formatValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    commitLocalValue(e.currentTarget.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitLocalValue(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      resetLocalValue();
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentValue = value === 'mixed' ? 0 : value;
      const multiplier = e.shiftKey ? 10 : 1;
      const delta = e.key === 'ArrowUp' ? step * multiplier : -step * multiplier;
      const nextValue = clamp(currentValue + delta);
      const formattedValue = formatValue(nextValue);
      setLocalValue(formattedValue);
      onChange(nextValue);
    }
  };

  // Scrub handling - uses onLiveChange during drag, onChange on commit
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrubEnabled || disabled) return;
    if (e.target === inputRef.current) return; // Don't scrub when clicking input

    const startValue = value === 'mixed' ? 0 : value;
    scrubStartRef.current = { x: e.clientX, startValue };
    scrubValueRef.current = startValue;
    setIsScrubbing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!scrubStartRef.current) return;
      const dx = moveEvent.clientX - scrubStartRef.current.x;
      const sensitivity = moveEvent.shiftKey ? 0.1 : 1;
      const delta = dx * sensitivity * step;
      const newValue = clamp(scrubStartRef.current.startValue + delta);
      scrubValueRef.current = newValue;
      // Update displayed value during scrub
      setLocalValue(formatValue(newValue));
      // Use live change for preview - throttled to prevent overwhelming composition
      if (onLiveChange) {
        const now = performance.now();
        if (now - lastLiveChangeRef.current >= LIVE_CHANGE_THROTTLE_MS) {
          lastLiveChangeRef.current = now;
          onLiveChange(newValue);
        }
      }
    };

    const handleMouseUp = () => {
      // Commit final value on mouseup
      if (scrubValueRef.current !== null) {
        onChange(scrubValueRef.current);
      }
      setIsScrubbing(false);
      scrubValueRef.current = null;
      scrubStartRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Blur to release focus for keyboard shortcuts
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Scroll wheel to adjust value (Shift = fine, normal = step)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (disabled) return;
      // Only respond when hovered, not when text-editing
      if (document.activeElement === inputRef.current) return;
      e.preventDefault();
      const currentValue = value === 'mixed' ? 0 : value;
      const multiplier = e.shiftKey ? 0.1 : 1;
      const direction = e.deltaY < 0 ? 1 : -1;
      const newValue = clamp(currentValue + direction * step * multiplier);
      const formattedValue = formatValue(newValue);
      setLocalValue(formattedValue);
      onChange(newValue);
    },
    [disabled, value, step, clamp, formatValue, onChange]
  );

  const isMixed = value === 'mixed';

  return (
    <div
      className={cn(
        'relative flex items-center h-7 bg-secondary border border-input rounded-md overflow-hidden transition-colors',
        'focus-within:ring-1 focus-within:ring-ring focus-within:border-ring',
        isScrubbing && 'ring-1 ring-ring border-ring',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && scrubEnabled && 'cursor-ew-resize',
        className
      )}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
    >
      {/* Label prefix */}
      {label && (
        <span className="pl-2 pr-1 text-[10px] text-muted-foreground select-none pointer-events-none">
          {label}
        </span>
      )}

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={localValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={isMixed ? 'Mixed' : placeholder}
        className={cn(
          'flex-1 h-full bg-transparent text-xs font-mono tabular-nums text-foreground outline-none',
          'px-1 min-w-0 cursor-text',
          isMixed && 'italic text-muted-foreground'
        )}
      />

      {/* Unit suffix - fixed width for alignment across different units */}
      <span
        className="pr-2 text-[10px] text-muted-foreground select-none pointer-events-none text-right"
        style={{ minWidth: unitWidth }}
      >
        {unit}
      </span>
    </div>
  );
}
