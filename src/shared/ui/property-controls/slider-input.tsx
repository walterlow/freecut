import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/shared/ui/cn';

type MixedValue = number | 'mixed';

const LIVE_CHANGE_THROTTLE_MS = 16; // ~60fps max
const CLICK_THRESHOLD = 3; // px — distinguishes click from drag
const SNAP_TOLERANCE = 0.03125; // 1/32 — magnetic snap to deciles
const MAX_STRETCH = 6; // px — max rubber-band overflow
const DEAD_ZONE = 24; // px — distance past edge before rubber-band starts
const MAX_CURSOR_RANGE = 160; // px — cursor distance at max stretch

interface SliderInputProps {
  value: MixedValue;
  /** Called on final commit (mouse up). Updates the actual value. */
  onChange: (value: number) => void;
  /** Called during drag for live preview. If not provided, onChange is used. */
  onLiveChange?: (value: number) => void;
  label?: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  formatInputValue?: (value: number) => string;
  parseInputValue?: (rawValue: string) => number;
  disabled?: boolean;
  className?: string;
}

function decimalsForStep(step: number): number {
  const s = step.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function roundToStep(val: number, step: number): number {
  const raw = Math.round(val / step) * step;
  return parseFloat(raw.toFixed(decimalsForStep(step)));
}

function snapToDecile(rawValue: number, min: number, max: number): number {
  const normalized = (rawValue - min) / (max - min);
  const nearest = Math.round(normalized * 10) / 10;
  if (Math.abs(normalized - nearest) <= SNAP_TOLERANCE) {
    return min + nearest * (max - min);
  }
  return rawValue;
}

/** Simple spring animation using rAF */
function animateSpring(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  onComplete?: () => void
): () => void {
  let velocity = 0;
  let current = from;
  const stiffness = 300;
  const damping = 25;
  const mass = 0.8;
  let rafId: number | null = null;
  let lastTime = performance.now();

  function tick(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 0.032);
    lastTime = now;

    const displacement = current - to;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;

    velocity += acceleration * dt;
    current += velocity * dt;

    onUpdate(current);

    if (Math.abs(displacement) < 0.01 && Math.abs(velocity) < 0.1) {
      onUpdate(to);
      onComplete?.();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}

/**
 * DialKit-inspired slider with:
 * - Label + value inline inside the track
 * - Click-to-snap with spring animation
 * - Rubber-band overflow when dragging past bounds
 * - Smart magnetic snapping to deciles on click
 * - Handle dodge (fades when overlapping text)
 * - Click value or double-click track to type exact value
 * - Hash marks at decile intervals
 */
export function SliderInput({
  value,
  onChange,
  onLiveChange,
  label,
  min,
  max,
  step = 1,
  unit,
  formatValue: formatValueProp,
  formatInputValue,
  parseInputValue,
  disabled = false,
  className,
}: SliderInputProps) {
  const isMixed = value === 'mixed';
  const numericValue = isMixed ? (min + max) / 2 : value;

  // Refs
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const valueSpanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastLiveChangeRef = useRef<number>(0);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const isClickRef = useRef(true);
  const rectRef = useRef<DOMRect | null>(null);
  const cancelSpringRef = useRef<(() => void) | null>(null);
  // Use ref for input value to avoid stale closures in blur handlers
  const inputValueRef = useRef('');

  // State
  const [fillPercent, setFillPercent] = useState(
    () => ((numericValue - min) / (max - min)) * 100
  );
  const [rubberStretch, setRubberStretch] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [localValue, setLocalValue] = useState<number | null>(null);
  const previousNumericValueRef = useRef(numericValue);

  const showInputRef = useRef(false);
  const isSubmittingRef = useRef(false);

  const displayNumericValue = localValue ?? numericValue;

  // Sync fill from props when not interacting and no spring is running
  useEffect(() => {
    if (!isInteracting && !cancelSpringRef.current) {
      setFillPercent(((numericValue - min) / (max - min)) * 100);
    }
  }, [numericValue, min, max, isInteracting]);

  useEffect(() => {
    const previousNumericValue = previousNumericValueRef.current;
    previousNumericValueRef.current = numericValue;

    if (showInput || isInteracting || localValue === null) {
      return;
    }

    if (numericValue === localValue || numericValue !== previousNumericValue) {
      setLocalValue(null);
    }
  }, [numericValue, localValue, isInteracting, showInput]);

  const formatDisplay = useCallback(
    (v: number) => {
      if (formatValueProp) return formatValueProp(v);
      const formatted = v.toFixed(decimalsForStep(step));
      return unit ? `${formatted}${unit}` : formatted;
    },
    [formatValueProp, step, unit]
  );

  const displayValue =
    isMixed && localValue === null ? 'Mixed' : formatDisplay(displayNumericValue);

  const positionToValue = useCallback(
    (clientX: number) => {
      const rect = rectRef.current;
      if (!rect) return numericValue;
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.max(min, Math.min(max, min + percent * (max - min)));
    },
    [min, max, numericValue]
  );

  const computeRubberStretch = useCallback((clientX: number, sign: number) => {
    const rect = rectRef.current;
    if (!rect) return 0;
    const distancePast = sign < 0 ? rect.left - clientX : clientX - rect.right;
    const overflow = Math.max(0, distancePast - DEAD_ZONE);
    return sign * MAX_STRETCH * Math.sqrt(Math.min(overflow / MAX_CURSOR_RANGE, 1.0));
  }, []);

  const emitLiveChange = useCallback(
    (newValue: number) => {
      if (onLiveChange) {
        const now = performance.now();
        if (now - lastLiveChangeRef.current >= LIVE_CHANGE_THROTTLE_MS) {
          lastLiveChangeRef.current = now;
          onLiveChange(newValue);
        }
      }
    },
    [onLiveChange]
  );

  const openTextInput = useCallback(() => {
    const raw = formatInputValue
      ? formatInputValue(numericValue)
      : numericValue.toFixed(decimalsForStep(step));
    setShowInput(true);
    showInputRef.current = true;
    setInputValue(raw);
    inputValueRef.current = raw;
  }, [formatInputValue, numericValue, step]);

  const commitTextInput = useCallback(() => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const raw = inputValueRef.current;
    const parsed = parseInputValue ? parseInputValue(raw) : parseFloat(raw);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      const rounded = roundToStep(clamped, step);
      setFillPercent(((rounded - min) / (max - min)) * 100);
      setLocalValue(rounded);
      onChange(rounded);
    }

    setShowInput(false);
    showInputRef.current = false;

    queueMicrotask(() => {
      isSubmittingRef.current = false;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  }, [min, max, step, onChange, parseInputValue]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (showInputRef.current || disabled) return;

      // Let clicks on the value span through for direct click-to-edit
      if (valueSpanRef.current && valueSpanRef.current.contains(e.target as Node)) {
        return;
      }

      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
      isClickRef.current = true;
      setIsInteracting(true);

      if (trackRef.current) {
        rectRef.current = trackRef.current.getBoundingClientRect();
      }

      if (cancelSpringRef.current) {
        cancelSpringRef.current();
        cancelSpringRef.current = null;
      }
    },
    [disabled]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isInteracting || !pointerDownPos.current) return;

      const dx = e.clientX - pointerDownPos.current.x;
      const dy = e.clientY - pointerDownPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (isClickRef.current && distance > CLICK_THRESHOLD) {
        isClickRef.current = false;
        setIsDragging(true);
      }

      if (!isClickRef.current) {
        const rect = rectRef.current;
        if (rect) {
          if (e.clientX < rect.left) {
            setRubberStretch(computeRubberStretch(e.clientX, -1));
          } else if (e.clientX > rect.right) {
            setRubberStretch(computeRubberStretch(e.clientX, 1));
          } else {
            setRubberStretch(0);
          }
        }

        const newValue = positionToValue(e.clientX);
        const rounded = roundToStep(newValue, step);
        const pct = ((rounded - min) / (max - min)) * 100;
        setFillPercent(pct);
        setLocalValue(rounded);
        emitLiveChange(rounded);
      }
    },
    [isInteracting, positionToValue, step, min, max, computeRubberStretch, emitLiveChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isInteracting) return;

      // If text input is open (e.g. from double-click), don't snap or blur
      if (showInputRef.current) {
        setIsInteracting(false);
        setIsDragging(false);
        pointerDownPos.current = null;
        return;
      }

      if (isClickRef.current) {
        const rawValue = positionToValue(e.clientX);
        const discreteSteps = (max - min) / step;
        const snappedValue =
          discreteSteps <= 10
            ? Math.max(min, Math.min(max, min + Math.round((rawValue - min) / step) * step))
            : roundToStep(snapToDecile(rawValue, min, max), step);

        const targetPct = ((snappedValue - min) / (max - min)) * 100;
        const currentPct = fillPercent;

        cancelSpringRef.current = animateSpring(
          currentPct,
          targetPct,
          (pct) => setFillPercent(pct),
          () => { cancelSpringRef.current = null; }
        );

        setLocalValue(snappedValue);
        onChange(roundToStep(snappedValue, step));
      } else {
        if (localValue !== null) {
          onChange(localValue);
        }
      }

      if (rubberStretch !== 0) {
        const startStretch = rubberStretch;
        animateSpring(startStretch, 0, (v) => setRubberStretch(v), () => setRubberStretch(0));
      }

      setIsInteracting(false);
      setIsDragging(false);
      pointerDownPos.current = null;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [isInteracting, positionToValue, min, max, step, fillPercent, onChange, localValue, rubberStretch]
  );

  // Focus input when it appears
  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showInput]);

  // Click on value span → open text input immediately
  const handleValueClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openTextInput();
  };

  // Double-click anywhere on track → open text input
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (showInputRef.current || disabled) return;
      e.preventDefault();
      openTextInput();
    },
    [disabled, openTextInput]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commitTextInput();
    } else if (e.key === 'Escape') {
      setShowInput(false);
      showInputRef.current = false;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    inputValueRef.current = e.target.value;
  };

  // Handle dodge — fade handle when it overlaps label or value
  const isActive = isInteracting || isHovered;
  const HANDLE_BUFFER = 8;
  const trackWidth = trackRef.current?.offsetWidth ?? 200;
  const labelWidth = labelRef.current?.offsetWidth ?? 30;
  const valueWidth = valueSpanRef.current?.offsetWidth ?? 40;
  const leftThreshold = ((8 + labelWidth + HANDLE_BUFFER) / trackWidth) * 100;
  const rightThreshold = ((trackWidth - 8 - valueWidth - HANDLE_BUFFER) / trackWidth) * 100;
  const valueDodge = fillPercent < leftThreshold || fillPercent > rightThreshold;
  const handleOpacity = !isActive ? 0 : valueDodge ? 0.1 : isDragging ? 0.9 : 0.5;

  // Hash marks — decile tick marks
  const discreteSteps = (max - min) / step;
  const hashMarks =
    discreteSteps <= 10
      ? Array.from({ length: Math.max(0, discreteSteps - 1) }, (_, i) => ((i + 1) * step) / (max - min) * 100)
      : [10, 20, 30, 40, 50, 60, 70, 80, 90];

  const stretchWidth = Math.abs(rubberStretch);
  const stretchX = rubberStretch < 0 ? rubberStretch : 0;

  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <div
        ref={trackRef}
        className={cn(
          'relative flex items-center h-7 rounded-md overflow-hidden select-none touch-none',
          'bg-secondary border border-input',
          'transition-colors duration-150',
          isActive && 'border-ring/50',
          isDragging && 'border-ring',
          disabled && 'opacity-50 pointer-events-none',
          !disabled && 'cursor-pointer'
        )}
        style={{
          width: stretchWidth > 0 ? `calc(100% + ${stretchWidth}px)` : undefined,
          transform: stretchX !== 0 ? `translateX(${stretchX}px)` : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Hash marks */}
        <div className="absolute inset-0 pointer-events-none">
          {hashMarks.map((pct) => (
            <div
              key={pct}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 w-px h-2 rounded-full',
                'transition-opacity duration-150',
                isActive ? 'bg-foreground/15' : 'bg-foreground/8'
              )}
              style={{ left: `${pct}%` }}
            />
          ))}
        </div>

        {/* Fill */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-md',
            'transition-colors duration-150'
          )}
          style={{
            width: `${Math.max(0, Math.min(100, fillPercent))}%`,
            background: isActive
              ? 'hsl(var(--foreground) / 0.12)'
              : 'hsl(var(--foreground) / 0.08)',
          }}
        />

        {/* Handle */}
        <div
          className="absolute top-1/2 w-[3px] h-3.5 rounded-full bg-foreground/90 pointer-events-none"
          style={{
            left: `max(4px, calc(${Math.max(0, Math.min(100, fillPercent))}% - 1.5px))`,
            transform: `translateY(-50%) scaleX(${isActive ? 1 : 0.25}) scaleY(${isActive && valueDodge ? 0.75 : 1})`,
            opacity: handleOpacity,
            transition: 'opacity 150ms, transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        />

        {/* Label (left) */}
        {label && (
          <span
            ref={labelRef}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none"
          >
            {label}
          </span>
        )}

        {/* Value (right) — click to edit */}
        {showInput ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-14 h-5 text-xs font-mono tabular-nums text-foreground text-right bg-background/80 border border-ring rounded px-1 outline-none"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={commitTextInput}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            ref={valueSpanRef}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 text-xs font-mono tabular-nums cursor-text',
              'text-muted-foreground hover:text-foreground transition-colors duration-150',
              isMixed && localValue === null && 'italic opacity-50'
            )}
            onClick={handleValueClick}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {displayValue}
          </span>
        )}
      </div>
    </div>
  );
}
