import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DebugOverlayProps {
  /** Unique identifier for the item */
  id?: string;
  /** Timeline start frame of the item */
  from?: number;
  /** Playback speed multiplier */
  speed: number;
  /** Original trimBefore value (frames) */
  trimBefore: number;
  /** Clamped/safe trimBefore value (frames) */
  safeTrimBefore: number;
  /** Source start position (frames) */
  sourceStart?: number;
  /** Source end position bound (frames) */
  sourceEnd?: number;
  /** Effective source end bound used for clamping (frames) */
  sourceEndBound?: number;
  /** Total source duration (frames) */
  sourceDuration: number;
  /** Timeline duration (frames) */
  durationInFrames: number;
  /** Source frames needed for playback */
  sourceFramesNeeded: number;
  /** Source end position needed (frames) */
  sourceEndPosition: number;
  /** Source media fps used for source frame conversions */
  sourceFps?: number;
  /** Whether seek position is invalid */
  isInvalidSeek: boolean;
  /** Whether playback would exceed source */
  exceedsSource: boolean;
  /** Frames per second for time calculations */
  fps?: number;
  /** Position of overlay */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Debug overlay component for Composition video items
 *
 * Shows detailed information about video timing, trimming, and playback.
 * Useful for diagnosing issues with sped-up clips, trimming, and exports.
 *
 * Usage:
 * ```tsx
 * <DebugOverlay
 *   id={item.id}
 *   speed={playbackRate}
 *   trimBefore={trimBefore}
 *   safeTrimBefore={safeTrimBefore}
 *   sourceDuration={sourceDuration}
 *   durationInFrames={item.durationInFrames}
 *   sourceFramesNeeded={sourceFramesNeeded}
 *   sourceEndPosition={sourceEndPosition}
 *   isInvalidSeek={isInvalidSeek}
 *   exceedsSource={exceedsSource}
 * />
 * ```
 */
export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  id,
  from,
  speed,
  trimBefore,
  safeTrimBefore,
  sourceStart,
  sourceEnd,
  sourceEndBound,
  sourceDuration,
  durationInFrames,
  sourceFramesNeeded,
  sourceEndPosition,
  fps = 30,
  sourceFps = fps,
  isInvalidSeek,
  exceedsSource,
  position = 'top-left',
}) => {
  // Debug overlay is only rendered during preview (not during export)
  // so we can always assume preview mode
  const isPreview = true;

  // Track player container position for portal mode
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!isPreview) return;

    const container = document.querySelector('[data-player-container]');
    if (!container) return;

    const updateRect = () => {
      setContainerRect(container.getBoundingClientRect());
    };

    updateRect();

    // Update on resize/scroll
    const observer = new ResizeObserver(updateRect);
    observer.observe(container);
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [isPreview]);

  const positionStyles: React.CSSProperties = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
  }[position];

  const copyToClipboard = useCallback(() => {
    const data = {
      id: id?.slice(0, 8) ?? 'unknown',
      from: from ?? 'unknown',
      endFrame: from !== undefined ? from + durationInFrames : 'unknown',
      speed: speed.toFixed(3),
      trimBefore,
      safeTrimBefore,
      sourceStart: sourceStart ?? 'undefined',
      sourceEnd: sourceEnd ?? 'undefined',
      sourceEndBound: sourceEndBound ?? 'undefined',
      sourceSpan: sourceStart !== undefined && sourceEnd !== undefined
        ? sourceEnd - sourceStart
        : 'unknown',
      sourceDuration: sourceDuration || 'NOT SET',
      durationInFrames,
      sourceFramesNeeded,
      sourceFps,
      seekTime: `${(trimBefore / sourceFps).toFixed(2)}s`,
      srcDuration: sourceDuration ? `${(sourceDuration / sourceFps).toFixed(2)}s` : 'N/A',
      srcEndNeeded: `${(sourceEndPosition / sourceFps).toFixed(2)}s`,
      isInvalidSeek,
      exceedsSource,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  }, [id, from, speed, trimBefore, safeTrimBefore, sourceStart, sourceEnd, sourceEndBound, sourceDuration, durationInFrames, sourceFramesNeeded, sourceEndPosition, sourceFps, isInvalidSeek, exceedsSource]);

  // Calculate position for portal mode (anchored to player container bottom-right)
  const portalPositionStyles: React.CSSProperties = containerRect
    ? {
        position: 'fixed' as const,
        bottom: window.innerHeight - containerRect.bottom + 10,
        right: window.innerWidth - containerRect.right + 10,
      }
    : {
        position: 'fixed' as const,
        bottom: 10,
        right: 10,
      };

  const content = (
    <div
      data-debug-overlay
      style={{
        ...(isPreview ? portalPositionStyles : { position: 'absolute' as const, ...positionStyles }),
        background: 'rgba(0,0,0,0.8)',
        color: '#fff',
        padding: '8px 12px',
        fontSize: 11,
        fontFamily: 'monospace',
        borderRadius: 4,
        maxWidth: isPreview ? 300 : '50%',
        zIndex: 99999,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ color: '#0f0', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>DEBUG: {id?.slice(0, 8) ?? 'unknown'}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            background: '#333',
            border: '1px solid #555',
            color: '#fff',
            padding: '2px 6px',
            fontSize: 10,
            cursor: 'pointer',
            borderRadius: 3,
            marginLeft: 8,
            pointerEvents: 'auto',
          }}
        >
          Copy
        </button>
      </div>
      <div>speed: {speed.toFixed(3)}</div>
      <div>from: {from ?? 'unknown'}</div>
      <div>endFrame: {from !== undefined ? from + durationInFrames : 'unknown'}</div>
      <div>
        trimBefore: {trimBefore}
        {trimBefore !== safeTrimBefore && ` → safe: ${safeTrimBefore}`}
      </div>
      <div>sourceStart: {sourceStart ?? 'undefined'}</div>
      <div>sourceEnd: {sourceEnd ?? 'undefined'}</div>
      <div>sourceEndBound: {sourceEndBound ?? 'undefined'}</div>
      <div>sourceSpan: {sourceStart !== undefined && sourceEnd !== undefined ? sourceEnd - sourceStart : 'unknown'}</div>
      <div>sourceDuration: {sourceDuration || 'NOT SET'}</div>
      <div>sourceFps: {sourceFps.toFixed(3)}</div>
      <div>durationInFrames: {durationInFrames}</div>
      <div>sourceFramesNeeded: {sourceFramesNeeded}</div>
      <div
        style={{
          marginTop: 4,
          borderTop: '1px solid #444',
          paddingTop: 4,
        }}
      >
        <div>seekTime: {(trimBefore / sourceFps).toFixed(2)}s</div>
        <div>
          srcDuration: {sourceDuration ? (sourceDuration / sourceFps).toFixed(2) + 's' : 'N/A'}
        </div>
        <div>srcEndNeeded: {(sourceEndPosition / sourceFps).toFixed(2)}s</div>
      </div>
      {(isInvalidSeek || exceedsSource) && (
        <div style={{ marginTop: 4, color: '#f00', fontWeight: 'bold' }}>
          {isInvalidSeek && <div>⚠️ INVALID SEEK</div>}
          {exceedsSource && <div>⚠️ EXCEEDS SOURCE</div>}
        </div>
      )}
    </div>
  );

  // In preview mode, use portal to escape the player's stacking context
  // This allows the button to be clickable above the GizmoOverlay
  if (isPreview && typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
};
