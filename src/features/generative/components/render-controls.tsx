import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Clapperboard, CheckCircle, AlertCircle } from 'lucide-react';
import { useGenerativeStore } from '../stores/generative-store';

interface RenderControlsProps {
  onRender?: () => void;
}

/**
 * Render Video button with progress indicator and status feedback.
 * Disabled during pipeline swaps or when no start image is set.
 */
export const RenderControls = memo(function RenderControls({ onRender }: RenderControlsProps) {
  const renderStatus = useGenerativeStore((s) => s.renderStatus);
  const renderProgress = useGenerativeStore((s) => s.renderProgress);
  const renderError = useGenerativeStore((s) => s.renderError);
  const pipelineReady = useGenerativeStore((s) => s.pipelineReady);
  const startImage = useGenerativeStore((s) => s.startImage);

  const isRendering = renderStatus === 'rendering';
  const isLoadingPipeline = renderStatus === 'loading-pipeline';
  const isComplete = renderStatus === 'complete';
  const isError = renderStatus === 'error';
  const canRender = pipelineReady && !!startImage && renderStatus === 'idle';

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        size="sm"
        variant={canRender ? 'default' : isError ? 'destructive' : 'secondary'}
        onClick={onRender}
        disabled={!canRender}
        className="min-w-[140px]"
      >
        {isRendering ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Rendering {Math.round(renderProgress * 100)}%
          </>
        ) : isLoadingPipeline ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Loading Pipeline...
          </>
        ) : isComplete ? (
          <>
            <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
            Render Complete
          </>
        ) : isError ? (
          <>
            <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
            Render Failed
          </>
        ) : (
          <>
            <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
            Render Video
          </>
        )}
      </Button>
      {isError && renderError && (
        <span className="text-[10px] text-destructive">{renderError}</span>
      )}
    </div>
  );
});
