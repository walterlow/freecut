/**
 * Spring parameter editor component.
 * Allows adjusting physics-based spring animation parameters.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { SpringParameters } from '@/types/keyframe';
import { DEFAULT_SPRING_PARAMS } from '@/types/keyframe';
import { springEasing } from '../utils/easing';

interface SpringEditorProps {
  /** Current spring parameters */
  value: SpringParameters;
  /** Callback when parameters change */
  onChange: (value: SpringParameters) => void;
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

/** Parameter constraints */
const PARAM_RANGES = {
  tension: { min: 10, max: 500, step: 10, default: 170 },
  friction: { min: 1, max: 100, step: 1, default: 26 },
  mass: { min: 0.1, max: 10, step: 0.1, default: 1 },
};

/**
 * Spring parameter editor with sliders and animated preview.
 */
export const SpringEditor = memo(function SpringEditor({
  value,
  onChange,
  disabled = false,
  className,
}: SpringEditorProps) {
  const handleTensionChange = useCallback(
    (v: number[]) => {
      const newValue = v[0];
      if (newValue !== undefined) {
        onChange({ ...value, tension: newValue });
      }
    },
    [onChange, value]
  );

  const handleFrictionChange = useCallback(
    (v: number[]) => {
      const newValue = v[0];
      if (newValue !== undefined) {
        onChange({ ...value, friction: newValue });
      }
    },
    [onChange, value]
  );

  const handleMassChange = useCallback(
    (v: number[]) => {
      const newValue = v[0];
      if (newValue !== undefined) {
        onChange({ ...value, mass: newValue });
      }
    },
    [onChange, value]
  );

  const handleReset = useCallback(() => {
    onChange(DEFAULT_SPRING_PARAMS);
  }, [onChange]);

  const isDefault =
    value.tension === DEFAULT_SPRING_PARAMS.tension &&
    value.friction === DEFAULT_SPRING_PARAMS.friction &&
    value.mass === DEFAULT_SPRING_PARAMS.mass;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Animated preview */}
      <SpringPreview value={value} />

      {/* Tension slider */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs">Tension (Stiffness)</Label>
          <span className="text-xs text-muted-foreground font-mono">{value.tension}</span>
        </div>
        <Slider
          value={[value.tension]}
          onValueChange={handleTensionChange}
          min={PARAM_RANGES.tension.min}
          max={PARAM_RANGES.tension.max}
          step={PARAM_RANGES.tension.step}
          disabled={disabled}
        />
      </div>

      {/* Friction slider */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs">Friction (Damping)</Label>
          <span className="text-xs text-muted-foreground font-mono">{value.friction}</span>
        </div>
        <Slider
          value={[value.friction]}
          onValueChange={handleFrictionChange}
          min={PARAM_RANGES.friction.min}
          max={PARAM_RANGES.friction.max}
          step={PARAM_RANGES.friction.step}
          disabled={disabled}
        />
      </div>

      {/* Mass slider */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs">Mass</Label>
          <span className="text-xs text-muted-foreground font-mono">{value.mass.toFixed(1)}</span>
        </div>
        <Slider
          value={[value.mass]}
          onValueChange={handleMassChange}
          min={PARAM_RANGES.mass.min}
          max={PARAM_RANGES.mass.max}
          step={PARAM_RANGES.mass.step}
          disabled={disabled}
        />
      </div>

      {/* Reset button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleReset}
        disabled={disabled || isDefault}
        className="w-full"
      >
        <RotateCcw className="w-3 h-3 mr-2" />
        Reset to Default
      </Button>
    </div>
  );
});

/**
 * Animated spring preview showing a bouncing ball.
 */
const SpringPreview = memo(function SpringPreview({
  value,
}: {
  value: SpringParameters;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate the ball when parameters change
  const startAnimation = useCallback(() => {
    if (!ballRef.current || !containerRef.current) return;

    const ball = ballRef.current;
    const container = containerRef.current;
    const containerWidth = container.offsetWidth;
    const ballSize = 16;
    const maxX = containerWidth - ballSize - 8; // Account for padding

    // Cancel previous animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    setIsAnimating(true);
    const startTime = performance.now();
    const duration = 1500; // 1.5 seconds

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Apply spring easing
      const easedProgress = springEasing(progress, value);

      // Move ball from left to right
      const x = easedProgress * maxX;
      ball.style.transform = `translateX(${x}px)`;

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
        // Auto-restart after a pause
        setTimeout(() => {
          if (ballRef.current) {
            ballRef.current.style.transform = 'translateX(0)';
            setTimeout(startAnimation, 100);
          }
        }, 500);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [value]);

  // Start animation on mount and when value changes
  useEffect(() => {
    const timeout = setTimeout(startAnimation, 100);
    return () => {
      clearTimeout(timeout);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [startAnimation]);

  return (
    <div
      ref={containerRef}
      className="relative h-10 bg-muted/30 rounded-md border border-border overflow-hidden"
    >
      {/* Track line */}
      <div className="absolute top-1/2 left-2 right-2 h-px bg-border" />

      {/* Ball */}
      <div
        ref={ballRef}
        className={cn(
          'absolute top-1/2 left-2 w-4 h-4 -mt-2 rounded-full bg-primary',
          'shadow-sm',
          isAnimating && 'ring-2 ring-primary/30'
        )}
        style={{ transform: 'translateX(0)' }}
      />

      {/* Start marker */}
      <div className="absolute top-1/2 left-2 w-1 h-3 -mt-1.5 bg-muted-foreground/30 rounded-full" />

      {/* End marker */}
      <div className="absolute top-1/2 right-2 w-1 h-3 -mt-1.5 bg-muted-foreground/30 rounded-full" />
    </div>
  );
});

/**
 * Compact spring curve preview (static).
 * Shows the spring curve shape based on parameters.
 */
export const SpringCurvePreview = memo(function SpringCurvePreview({
  value,
  width = 48,
  height = 48,
  className,
}: {
  value: SpringParameters;
  width?: number;
  height?: number;
  className?: string;
}) {
  // Sample the spring function at multiple points
  const points: string[] = [];
  const padding = 4;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const y = springEasing(t, value);
    const svgX = padding + t * usableWidth;
    const svgY = padding + (1 - Math.min(1.2, Math.max(-0.2, y))) * usableHeight;
    points.push(`${i === 0 ? 'M' : 'L'} ${svgX.toFixed(1)},${svgY.toFixed(1)}`);
  }

  return (
    <svg
      width={width}
      height={height}
      className={cn('bg-muted/30 rounded', className)}
    >
      {/* Background box */}
      <rect
        x={padding}
        y={padding}
        width={usableWidth}
        height={usableHeight}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.1}
        strokeWidth={1}
      />
      {/* Curve */}
      <path
        d={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
