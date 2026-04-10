import { memo, useState } from 'react';
import { cn } from '@/shared/ui/cn';
import type { AudioFadeHandle } from '../../utils/audio-fade';

interface VideoFadeHandlesProps {
  trackLocked: boolean;
  activeTool: string;
  lineYPercent: number;
  fadeInPercent: number;
  fadeOutPercent: number;
  isSelected: boolean;
  isEditing: boolean;
  fadeInLabel?: string;
  fadeOutLabel?: string;
  onFadeHandleMouseDown: (e: React.MouseEvent, handle: AudioFadeHandle) => void;
  onFadeHandleDoubleClick: (handle: AudioFadeHandle) => void;
}

export const VideoFadeHandles = memo(function VideoFadeHandles({
  trackLocked,
  activeTool,
  lineYPercent,
  fadeInPercent,
  fadeOutPercent,
  isSelected,
  isEditing,
  fadeInLabel,
  fadeOutLabel,
  onFadeHandleMouseDown,
  onFadeHandleDoubleClick,
}: VideoFadeHandlesProps) {
  const [hoveredHandle, setHoveredHandle] = useState<AudioFadeHandle | null>(null);

  if (trackLocked || activeTool !== 'select') {
    return null;
  }

  const handleVisibilityClass = isEditing || isSelected
    ? 'opacity-100'
    : 'opacity-0 group-hover/timeline-item:opacity-100';
  const fadeInLeft = Math.max(0, Math.min(100, fadeInPercent));
  const fadeOutLeft = Math.max(0, Math.min(100, 100 - fadeOutPercent));
  const activeLeft = hoveredHandle === 'in' ? fadeInLeft : fadeOutLeft;
  const visibleLabel = hoveredHandle === 'in'
    ? fadeInLabel
    : hoveredHandle === 'out'
      ? fadeOutLabel
      : null;
  const handleTop = '-2px';

  const getHandleClassName = () => cn(
    'absolute h-2.5 w-2.5 -translate-x-1/2 rounded-[2px] border pointer-events-auto transition-opacity cursor-ew-resize touch-none before:absolute before:-inset-[9px] before:content-[""] after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-l-[3px] after:border-r-[3px] after:border-t-[4px] after:border-l-transparent after:border-r-transparent focus-visible:outline-none',
    'border-slate-950/70 bg-white after:border-t-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.25)]',
    handleVisibilityClass,
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-30">
      <button
        type="button"
        className={getHandleClassName()}
        style={{ left: `${fadeInLeft}%`, top: handleTop }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => onFadeHandleMouseDown(e, 'in')}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFadeHandleDoubleClick('in');
        }}
        onMouseEnter={() => setHoveredHandle('in')}
        onMouseLeave={() => setHoveredHandle((current) => (current === 'in' ? null : current))}
        aria-label="Adjust video fade in"
      />
      <button
        type="button"
        className={getHandleClassName()}
        style={{ left: `${fadeOutLeft}%`, top: handleTop }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => onFadeHandleMouseDown(e, 'out')}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFadeHandleDoubleClick('out');
        }}
        onMouseEnter={() => setHoveredHandle('out')}
        onMouseLeave={() => setHoveredHandle((current) => (current === 'out' ? null : current))}
        aria-label="Adjust video fade out"
      />

      {hoveredHandle && visibleLabel && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-950/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg whitespace-nowrap"
          style={{ left: `${activeLeft}%`, top: `calc(${lineYPercent}% + 10px)` }}
        >
          {visibleLabel}
        </div>
      )}
    </div>
  );
});
