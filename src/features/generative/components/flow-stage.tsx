import { memo } from 'react';
import { NodeStart } from './node-start';
import { NodeBridge } from './node-bridge';
import { NodeEnd } from './node-end';
import { RenderControls } from './render-controls';
import { useLiveSessionStore } from '@/features/live-ai/stores/live-session-store';

/**
 * Flow Keyframe Stage (Zone 2).
 * Three-node horizontal layout: Start Image -> Generative Bridge -> End Image.
 * Displayed as an alternative to the standard program monitor.
 */
export const FlowStage = memo(function FlowStage() {
  const scopeSession = useLiveSessionStore((s) => s.scopeSession);
  const remoteStream = scopeSession?.remoteStream ?? null;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background p-4">
      {/* Three-node horizontal layout */}
      <div className="flex items-center gap-4">
        {/* Node A: Start Image */}
        <NodeStart />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Node B: Generative Bridge */}
        <NodeBridge remoteStream={remoteStream} />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
        </svg>

        {/* Node C: End Image (Optional) */}
        <NodeEnd />
      </div>

      {/* Render controls */}
      <RenderControls />
    </div>
  );
});
