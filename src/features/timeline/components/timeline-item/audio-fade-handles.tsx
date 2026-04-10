import { memo, useState } from 'react';
import { cn } from '@/shared/ui/cn';

interface AudioFadeHandlesProps {
  trackLocked: boolean;
  activeTool: string;
  lineYPercent: number;
  fadeInPercent: number;
  fadeOutPercent: number;
  isSelected: boolean;
  isEditing: boolean;
  curveEditingHandle: 'in' | 'out' | null;
  fadeInLabel?: string;
  fadeOutLabel?: string;
  fadeInCurveDot?: { xPercent: number; yPercent: number } | null;
  fadeOutCurveDot?: { xPercent: number; yPercent: number } | null;
  onFadeHandleMouseDown: (e: React.MouseEvent, handle: 'in' | 'out') => void;
  onFadeHandleDoubleClick: (handle: 'in' | 'out') => void;
  onFadeCurveDotMouseDown: (e: React.MouseEvent, handle: 'in' | 'out') => void;
  onFadeCurveDotDoubleClick: (handle: 'in' | 'out') => void;
}

export const AudioFadeHandles = memo(function AudioFadeHandles({
  trackLocked,
  activeTool,
  lineYPercent,
  fadeInPercent,
  fadeOutPercent,
  isSelected,
  isEditing,
  curveEditingHandle,
  fadeInLabel,
  fadeOutLabel,
  fadeInCurveDot,
  fadeOutCurveDot,
  onFadeHandleMouseDown,
  onFadeHandleDoubleClick,
  onFadeCurveDotMouseDown,
  onFadeCurveDotDoubleClick,
}: AudioFadeHandlesProps) {
  const [hoveredHandle, setHoveredHandle] = useState<'in' | 'out' | null>(null);

  if (trackLocked || activeTool !== 'select') {
    return null;
  }

  const handleVisibilityClass = isEditing || isSelected
    ? 'opacity-100'
    : 'opacity-0 group-hover/timeline-item:opacity-100';
  const fadeInLeft = Math.max(0, Math.min(100, fadeInPercent));
  const fadeOutLeft = Math.max(0, Math.min(100, 100 - fadeOutPercent));
  const visibleLabelHandle = hoveredHandle;
  const activeLeft = visibleLabelHandle === 'in' ? fadeInLeft : fadeOutLeft;
  const visibleLabel = hoveredHandle === 'in'
    ? fadeInLabel
    : hoveredHandle === 'out'
    ? fadeOutLabel
    : null;
  const handleTop = '-2px';

  const getHandleClassName = () => {
    return cn(
      'absolute h-2.5 w-2.5 -translate-x-1/2 rounded-[2px] border pointer-events-auto transition-opacity cursor-ew-resize touch-none before:absolute before:-inset-[9px] before:content-[""] after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-l-[3px] after:border-r-[3px] after:border-t-[4px] after:border-l-transparent after:border-r-transparent focus-visible:outline-none',
      'border-slate-950/70 bg-white after:border-t-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.25)]',
      handleVisibilityClass,
    );
  };

  const getCurveDotClassName = (handle: 'in' | 'out') => {
    const isActive = curveEditingHandle === handle || hoveredHandle === handle;

    return cn(
      'absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-200/90 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] transition-opacity pointer-events-auto cursor-move touch-none before:absolute before:-inset-[8px] before:content-[""] focus-visible:outline-none',
      isActive ? 'bg-orange-500 opacity-100' : 'bg-orange-400/90 opacity-0 group-hover/timeline-item:opacity-100',
    );
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      <button
        type="button"
        className={getHandleClassName()}
        style={{ left: `${fadeInLeft}%`, top: handleTop }}
        onMouseDown={(e) => onFadeHandleMouseDown(e, 'in')}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFadeHandleDoubleClick('in');
        }}
        onMouseEnter={() => setHoveredHandle('in')}
        onMouseLeave={() => setHoveredHandle((current) => (current === 'in' ? null : current))}
        aria-label="Adjust audio fade in"
      />
      <button
        type="button"
        className={getHandleClassName()}
        style={{ left: `${fadeOutLeft}%`, top: handleTop }}
        onMouseDown={(e) => onFadeHandleMouseDown(e, 'out')}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFadeHandleDoubleClick('out');
        }}
        onMouseEnter={() => setHoveredHandle('out')}
        onMouseLeave={() => setHoveredHandle((current) => (current === 'out' ? null : current))}
        aria-label="Adjust audio fade out"
      />

      {fadeInCurveDot && (
        <button
          type="button"
          className={getCurveDotClassName('in')}
          style={{ left: `${fadeInCurveDot.xPercent}%`, top: `${fadeInCurveDot.yPercent}%` }}
          onMouseDown={(e) => onFadeCurveDotMouseDown(e, 'in')}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFadeCurveDotDoubleClick('in');
          }}
          onMouseEnter={() => setHoveredHandle(null)}
          onMouseLeave={() => setHoveredHandle((current) => (current === 'in' ? null : current))}
          aria-label="Adjust audio fade in curve"
        />
      )}
      {fadeOutCurveDot && (
        <button
          type="button"
          className={getCurveDotClassName('out')}
          style={{ left: `${fadeOutCurveDot.xPercent}%`, top: `${fadeOutCurveDot.yPercent}%` }}
          onMouseDown={(e) => onFadeCurveDotMouseDown(e, 'out')}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFadeCurveDotDoubleClick('out');
          }}
          onMouseEnter={() => setHoveredHandle(null)}
          onMouseLeave={() => setHoveredHandle((current) => (current === 'out' ? null : current))}
          aria-label="Adjust audio fade out curve"
        />
      )}

      {visibleLabelHandle && visibleLabel && (
        <div
          className="absolute -translate-x-1/2 rounded bg-slate-950/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg whitespace-nowrap"
          style={{ left: `${activeLeft}%`, top: `calc(${lineYPercent}% + 10px)` }}
        >
          {visibleLabel}
        </div>
      )}
    </div>
  );
});
