import { memo, useState } from 'react';
import { cn } from '@/shared/ui/cn';
import { getAudioFadeHandleLeft, type AudioFadeHandle } from '../../utils/audio-fade';

interface VideoFadeHandlesProps {
  trackLocked: boolean;
  activeTool: string;
  clipWidth: number;
  lineYPercent: number;
  fadeInPixels: number;
  fadeOutPixels: number;
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
  clipWidth,
  lineYPercent,
  fadeInPixels,
  fadeOutPixels,
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
  const fadeInLeft = getAudioFadeHandleLeft({ handle: 'in', clipWidthPixels: clipWidth, fadePixels: fadeInPixels });
  const fadeOutLeft = getAudioFadeHandleLeft({ handle: 'out', clipWidthPixels: clipWidth, fadePixels: fadeOutPixels });
  const activeLeft = hoveredHandle === 'in' ? fadeInLeft : fadeOutLeft;
  const visibleLabel = hoveredHandle === 'in'
    ? fadeInLabel
    : hoveredHandle === 'out'
      ? fadeOutLabel
      : null;

  const getHandleClassName = () => cn(
    'absolute h-2.5 w-2.5 -translate-x-1/2 rounded-[2px] border pointer-events-auto transition-opacity cursor-ew-resize touch-none before:absolute before:-inset-[9px] before:content-[""] after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-l-[3px] after:border-r-[3px] after:border-t-[4px] after:border-l-transparent after:border-r-transparent',
    'border-slate-950/70 bg-white after:border-t-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.25)]',
    handleVisibilityClass,
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-30">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className={getHandleClassName()}
        style={{ left: `${fadeInLeft}px`, top: '-2px' }}
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
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className={getHandleClassName()}
        style={{ left: `${fadeOutLeft}px`, top: '-2px' }}
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
      />

      {hoveredHandle && visibleLabel && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full rounded bg-slate-950/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg whitespace-nowrap"
          style={{ left: `${activeLeft}px`, top: `calc(${lineYPercent}% + 10px)` }}
        >
          {visibleLabel}
        </div>
      )}
    </div>
  );
});
