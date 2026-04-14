import { memo } from 'react';
import { Video } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useGenerativeStore } from '../stores/generative-store';
import { VideoResultPlayer } from './video-result-player';
import { GenerationProgress } from './generation-progress';

interface NodeBridgeProps {
  onCancelVideo: () => void;
}

export const NodeBridge = memo(function NodeBridge({ onCancelVideo }: NodeBridgeProps) {
  const prompt = useGenerativeStore((s) => s.prompt);
  const setPrompt = useGenerativeStore((s) => s.setPrompt);
  const videoTask = useGenerativeStore((s) => s.videoTask);
  const resultVideoUrl = useGenerativeStore((s) => s.resultVideoUrl);

  const isGenerating = videoTask.status === 'pending' || videoTask.status === 'processing';

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Generated Video</span>
      <div className="relative flex h-28 w-48 items-center justify-center overflow-hidden rounded-lg border border-border bg-black sm:h-40 sm:w-64">
        {resultVideoUrl ? (
          <VideoResultPlayer url={resultVideoUrl} />
        ) : isGenerating ? (
          <div className="flex flex-col items-center gap-2 p-4">
            <GenerationProgress task={videoTask} label="Video" onCancel={onCancelVideo} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Video className="h-8 w-8" />
            <span className="text-xs text-center px-2">
              {videoTask.status === 'failed'
                ? videoTask.error ?? 'Generation failed'
                : 'Set images & prompt, then generate'}
            </span>
          </div>
        )}
      </div>

      <div className="flex w-48 flex-col gap-1 sm:w-64">
        <Label htmlFor="video-prompt" className="text-xs">
          Prompt
        </Label>
        <Textarea
          id="video-prompt"
          placeholder="Describe the motion and scene..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isGenerating}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
    </div>
  );
});
