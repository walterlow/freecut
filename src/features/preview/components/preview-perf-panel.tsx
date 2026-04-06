import { memo } from 'react';
import {
  PREVIEW_PERF_PANEL_QUERY_KEY,
  type PreviewPerfSnapshot,
} from '../utils/preview-constants';

interface PreviewPerfPanelProps {
  snapshot: PreviewPerfSnapshot;
  latestRenderSourceSwitch: PreviewPerfSnapshot['renderSourceHistory'][number] | null;
}

function formatRenderSource(source: string) {
  return source === 'fast_scrub_overlay'
    ? 'Overlay'
    : source === 'playback_transition_overlay'
      ? 'Transition'
      : 'Player';
}

export const PreviewPerfPanel = memo(function PreviewPerfPanel({
  snapshot,
  latestRenderSourceSwitch,
}: PreviewPerfPanelProps) {
  const srcLabel = formatRenderSource(snapshot.renderSource);
  const srcColor = snapshot.renderSource === 'player' ? '#4ade80' : '#60a5fa';
  const seekOk = snapshot.seekLatencyAvgMs < 50;
  const qualOk = snapshot.effectivePreviewQuality >= snapshot.userPreviewQuality;
  const frameOk = snapshot.frameTimeEmaMs <= snapshot.frameTimeBudgetMs * 1.2;
  const transitionActive = snapshot.transitionSessionActive;
  const transitionMode = snapshot.transitionSessionMode === 'none'
    ? null
    : snapshot.transitionSessionMode === 'dom'
      ? 'DOM'
      : 'Canvas';

  return (
    <div
      className="absolute right-2 bottom-2 z-30 bg-black/80 text-white/90 rounded-md text-[10px] leading-[14px] font-mono pointer-events-none select-none backdrop-blur-sm"
      style={{ padding: '6px 8px', minWidth: 180 }}
      data-testid="preview-perf-panel"
      title={`Toggle: Alt+Shift+P | URL: ?${PREVIEW_PERF_PANEL_QUERY_KEY}=1`}
    >
      <div style={{ marginBottom: 3 }}>
        <span style={{ color: srcColor }}>{srcLabel}</span>
        {snapshot.staleScrubOverlayDrops > 0 && (
          <span style={{ color: '#f87171' }}> {snapshot.staleScrubOverlayDrops} stale</span>
        )}
        {latestRenderSourceSwitch && (
          <span style={{ color: '#a1a1aa' }}>
            {' '}{formatRenderSource(latestRenderSourceSwitch.from)}{'\u2192'}
            {formatRenderSource(latestRenderSourceSwitch.to)} @{latestRenderSourceSwitch.atFrame}
          </span>
        )}
      </div>

      <div>
        <span style={{ color: seekOk ? '#a1a1aa' : '#fbbf24' }}>
          Seek {snapshot.seekLatencyAvgMs.toFixed(0)}ms
        </span>
        {snapshot.seekLatencyTimeouts > 0 && (
          <span style={{ color: '#f87171' }}> {snapshot.seekLatencyTimeouts} timeout</span>
        )}
        {snapshot.scrubDroppedFrames > 0 && (
          <span style={{ color: '#fbbf24' }}>
            {' '}Scrub {snapshot.scrubDroppedFrames}/{snapshot.scrubUpdates} dropped
          </span>
        )}
      </div>

      <div>
        <span style={{ color: qualOk ? '#a1a1aa' : '#fbbf24' }}>
          Quality {snapshot.effectivePreviewQuality}x
          {snapshot.effectivePreviewQuality < snapshot.userPreviewQuality
            && ` (cap ${snapshot.adaptiveQualityCap}x)`}
        </span>
        {' '}
        <span style={{ color: frameOk ? '#a1a1aa' : '#f87171' }}>
          {snapshot.frameTimeEmaMs.toFixed(0)}/{snapshot.frameTimeBudgetMs.toFixed(0)}ms
        </span>
        {(snapshot.adaptiveQualityDowngrades > 0 || snapshot.adaptiveQualityRecovers > 0) && (
          <span style={{ color: '#a1a1aa' }}>
            {' '}{'\u2193'}{snapshot.adaptiveQualityDowngrades} {'\u2191'}{snapshot.adaptiveQualityRecovers}
          </span>
        )}
      </div>

      <div style={{ color: '#a1a1aa' }}>
        Pool {snapshot.sourceWarmKeep}/{snapshot.sourceWarmTarget}
        {' '}({snapshot.sourcePoolSources}src {snapshot.sourcePoolElements}el)
        {snapshot.sourceWarmEvictions > 0 && (
          <span style={{ color: '#fbbf24' }}> {snapshot.sourceWarmEvictions} evict</span>
        )}
      </div>

      {(snapshot.preseekRequests > 0 || snapshot.preseekCachedBitmaps > 0) && (
        <div style={{ color: '#a1a1aa' }}>
          Preseek {snapshot.preseekCacheHits + snapshot.preseekInflightReuses}/{snapshot.preseekRequests} hit
          {' '}post {snapshot.preseekWorkerSuccesses}/{snapshot.preseekWorkerPosts}
          {' '}cache {snapshot.preseekCachedBitmaps}
          {snapshot.preseekWaitMatches > 0 && (
            <span>
              {' '}wait {snapshot.preseekWaitResolved}/{snapshot.preseekWaitMatches}
            </span>
          )}
          {snapshot.preseekWorkerFailures > 0 && (
            <span style={{ color: '#fbbf24' }}> {snapshot.preseekWorkerFailures} fail</span>
          )}
          {snapshot.preseekWaitTimeouts > 0 && (
            <span style={{ color: '#fbbf24' }}> {snapshot.preseekWaitTimeouts} timeout</span>
          )}
        </div>
      )}

      {(snapshot.unresolvedQueue > 0 || snapshot.pendingResolves > 0) && (
        <div style={{ color: '#fbbf24' }}>
          Resolving {snapshot.pendingResolves} pending, {snapshot.unresolvedQueue} queued
          {' '}({snapshot.resolveAvgMs.toFixed(0)}ms avg)
        </div>
      )}

      {(transitionActive || snapshot.transitionSessionCount > 0) && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 3, paddingTop: 3 }}>
          <div>
            <span style={{ color: transitionActive ? '#60a5fa' : '#a1a1aa' }}>
              {transitionActive ? `Transition ${transitionMode}` : 'Last transition'}
              {snapshot.transitionSessionComplex ? ' (complex)' : ''}
            </span>
            {transitionActive && (
              <span style={{ color: '#a1a1aa' }}>
                {' '}{snapshot.transitionSessionStartFrame}{'\u2192'}{snapshot.transitionSessionEndFrame}
                {' '}buf:{snapshot.transitionBufferedFrames}
              </span>
            )}
          </div>
          {snapshot.transitionLastPrepareMs > 0 && (
            <div style={{ color: snapshot.transitionLastEntryMisses > 0 ? '#f87171' : '#a1a1aa' }}>
              Prep {snapshot.transitionLastPrepareMs.toFixed(0)}ms
              {snapshot.transitionLastReadyLeadMs > 0
                && ` lead ${snapshot.transitionLastReadyLeadMs.toFixed(0)}ms`}
              {snapshot.transitionLastEntryMisses > 0 && ` ${snapshot.transitionLastEntryMisses} miss`}
              <span style={{ color: '#a1a1aa' }}> #{snapshot.transitionSessionCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
