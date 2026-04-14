import { memo, useCallback } from 'react';
import { NodeStart } from './node-start';
import { NodeBridge } from './node-bridge';
import { NodeEnd } from './node-end';
import { RenderControls } from './render-controls';
import { ApiKeyInput } from './api-key-input';
import { isEvolinkConfigured } from '../services/evolink-client';
import { useGenerativeStore } from '../stores/generative-store';
import { IDLE_TASK } from '../types';

/**
 * Flow Stage (Zone 2).
 * Three-node horizontal layout: Start Image -> Video Generation -> End Image.
 * Uses Seedance 2.0 (image-to-video) and Nanobanana 2 (image generation).
 */
export const FlowStage = memo(function FlowStage() {
  const setVideoTask = useGenerativeStore((s) => s.setVideoTask);
  const setResultVideoUrl = useGenerativeStore((s) => s.setResultVideoUrl);

  const handleCancelVideo = useCallback(() => {
    setVideoTask({ ...IDLE_TASK });
    setResultVideoUrl(null);
  }, [setVideoTask, setResultVideoUrl]);

  const configured = isEvolinkConfigured();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background p-4">
      {!configured && <ApiKeyInput />}

      {/* Three-node horizontal layout */}
      <div className="flex items-center gap-4">
        {/* Node A: Start Image */}
        <NodeStart />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line
            x1="0"
            y1="1"
            x2="40"
            y2="1"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>

        {/* Node B: Video Generation */}
        <NodeBridge onCancelVideo={handleCancelVideo} />

        {/* Connector arrow */}
        <svg width="40" height="2" className="text-border">
          <line
            x1="0"
            y1="1"
            x2="40"
            y2="1"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>

        {/* Node C: End Image (Optional) */}
        <NodeEnd />
      </div>

      {/* Render controls */}
      {configured && <RenderControls />}
    </div>
  );
});
