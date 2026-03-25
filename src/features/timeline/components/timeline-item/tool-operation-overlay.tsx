import { memo } from 'react';
import { cn } from '@/shared/ui/cn';
import { EDITOR_LAYOUT } from '@/shared/ui/editor-layout';
import type { OperationBoundsVisual } from './tool-operation-overlay-utils';

interface ToolOperationOverlayProps {
  visual: OperationBoundsVisual | null;
}

export const ToolOperationOverlay = memo(function ToolOperationOverlay({
  visual,
}: ToolOperationOverlayProps) {
  if (!visual) return null;

  const activeEdgePositions = visual.edgePositionsPx.filter((position, index, positions) => (
    Number.isFinite(position)
    && positions.findIndex((candidate) => Math.abs(candidate - position) < 0.5) === index
  ));

  const usesCompactTopBox = visual.mode === 'rolling'
    || visual.mode === 'slide';
  const usesSlipBodyBox = visual.mode === 'slip';
  const usesFilledBoundsBox = visual.mode === 'trim'
    || visual.mode === 'ripple'
    || visual.mode === 'stretch';
  const showBoundsBox = visual.boxLeftPx !== null && visual.boxWidthPx !== null;
  const boxTop = usesCompactTopBox
    ? 0
    : usesSlipBodyBox
    ? Math.round(EDITOR_LAYOUT.timelineClipLabelRowHeight)
    : 4;
  const boxHeight = usesCompactTopBox
    ? Math.round(EDITOR_LAYOUT.timelineClipLabelRowHeight * 2)
    : null;

  const boxAccentClass = usesCompactTopBox
    ? cn(
        'border-white/85 bg-transparent shadow-[0_0_0_1px_rgba(248,250,252,0.24),0_8px_20px_rgba(15,23,42,0.16)]',
        visual.constrained && 'border-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.36),0_0_14px_rgba(255,255,255,0.14),0_8px_20px_rgba(15,23,42,0.16)]',
      )
    : usesSlipBodyBox
    ? cn(
        'border-white/85 bg-transparent shadow-[0_0_0_1px_rgba(248,250,252,0.24),0_10px_24px_rgba(15,23,42,0.18)]',
        visual.constrained && 'border-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.36),0_0_14px_rgba(255,255,255,0.14),0_10px_24px_rgba(15,23,42,0.18)]',
      )
    : usesFilledBoundsBox
    ? 'border-white/80 bg-white/[0.035] shadow-[0_0_0_1px_rgba(15,23,42,0.45),0_10px_24px_rgba(15,23,42,0.18)]'
    : 'border-white/80 bg-white/[0.035] shadow-[0_0_0_1px_rgba(15,23,42,0.45),0_10px_24px_rgba(15,23,42,0.18)]';

  const edgeModeClass = visual.mode === 'ripple'
    ? 'bg-amber-300/20 shadow-[0_0_10px_rgba(251,191,36,0.26)]'
    : visual.mode === 'rolling'
    ? 'bg-sky-300/18 shadow-[0_0_10px_rgba(125,211,252,0.22)]'
    : 'bg-transparent shadow-none';
  const edgeCoreClass = 'bg-emerald-300/90 shadow-[0_0_14px_rgba(74,222,128,0.98),0_0_28px_rgba(34,197,94,0.62)]';

  return (
    <>
      {showBoundsBox && (
        <div
          data-testid="tool-operation-bounds-box"
          className={cn(
            'absolute pointer-events-none z-30 rounded-[6px] border',
            boxAccentClass,
          )}
          style={{
            left: `${visual.boxLeftPx}px`,
            width: `${visual.boxWidthPx}px`,
            top: boxTop,
            ...(boxHeight === null ? { bottom: 4 } : { height: boxHeight }),
          }}
        />
      )}

      {activeEdgePositions.map((edgePx, index) => {
        const isEdgeConstrained = visual.edgeConstraintStates[index] ?? visual.constrained;

        return (
        <div
          key={`${index}-${Math.round(edgePx)}`}
          className="absolute pointer-events-none z-40 -translate-x-1/2"
          style={{
            left: `${edgePx}px`,
            top: 2,
            bottom: 2,
          }}
        >
          <div
            className={cn(
              'absolute inset-y-0 left-1/2 w-[8px] -translate-x-1/2 rounded-full',
              isEdgeConstrained ? 'bg-red-600/34 shadow-[0_0_14px_rgba(239,68,68,0.82),0_0_30px_rgba(185,28,28,0.46)]' : edgeModeClass,
            )}
          />
          <div
            className={cn(
              'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/95',
              isEdgeConstrained
                ? 'shadow-none'
                : 'shadow-[0_0_8px_rgba(236,253,245,0.96)]',
            )}
          />
          <div
            data-testid="tool-operation-edge-core"
            data-edge-constrained={isEdgeConstrained ? 'true' : 'false'}
            className={cn(
              'absolute inset-y-1 left-1/2 w-[3px] -translate-x-1/2 rounded-full',
              isEdgeConstrained
                ? 'bg-red-500/90 shadow-[0_0_14px_rgba(248,113,113,0.98),0_0_28px_rgba(220,38,38,0.68)]'
                : edgeCoreClass,
            )}
          />
        </div>
        );
      })}
    </>
  );
});
