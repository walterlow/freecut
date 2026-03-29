import type { CSSProperties } from 'react';
import { cn } from '@/shared/ui/cn';

export interface KeyframeMarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const KEYFRAME_MARQUEE_THRESHOLD = 2;

const KEYFRAME_MARQUEE_CLASSNAME =
  'absolute border border-primary/70 bg-primary/20 pointer-events-none z-20';

interface KeyframeMarqueeOverlayProps {
  rect: KeyframeMarqueeRect | null;
  className?: string;
  style?: CSSProperties;
}

export function KeyframeMarqueeOverlay({
  rect,
  className,
  style,
}: KeyframeMarqueeOverlayProps) {
  if (!rect) return null;

  return (
    <div
      className={cn(KEYFRAME_MARQUEE_CLASSNAME, className)}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...style,
      }}
    />
  );
}

interface KeyframeSvgMarqueeProps {
  rect: KeyframeMarqueeRect | null;
}

export function KeyframeSvgMarquee({ rect }: KeyframeSvgMarqueeProps) {
  if (!rect) return null;

  return (
    <rect
      className="text-primary"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill="currentColor"
      fillOpacity={0.2}
      pointerEvents="none"
      stroke="currentColor"
      strokeOpacity={0.7}
      strokeWidth={1}
    />
  );
}
