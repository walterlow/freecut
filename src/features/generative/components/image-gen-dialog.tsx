import { memo, useState, useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGenerativeStore } from '../stores/generative-store';
import { useTaskPolling } from '../hooks/use-task-polling';
import { submitImageGeneration, getImageTaskDetail } from '../services/nanobanana-service';
import { isEvolinkConfigured } from '../services/evolink-client';
import { GenerationProgress } from './generation-progress';
import type { ImageSource, NanobananaSize, NanobananaQuality } from '../types';

interface ImageGenDialogProps {
  node: 'start' | 'end';
  onImageGenerated: (source: ImageSource) => void;
}

const SIZE_OPTIONS: { value: NanobananaSize; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1 Square' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
];

const QUALITY_OPTIONS: { value: NanobananaQuality; label: string }[] = [
  { value: '0.5K', label: '0.5K (Fast)' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K (Default)' },
  { value: '4K', label: '4K (Best)' },
];

export const ImageGenDialog = memo(function ImageGenDialog({
  node,
  onImageGenerated,
}: ImageGenDialogProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const imageSize = useGenerativeStore((s) => s.imageSize);
  const imageQuality = useGenerativeStore((s) => s.imageQuality);
  const setImageSize = useGenerativeStore((s) => s.setImageSize);
  const setImageQuality = useGenerativeStore((s) => s.setImageQuality);

  const taskKey = node === 'start' ? 'startImageTask' : 'endImageTask';
  const task = useGenerativeStore((s) => s[taskKey]);
  const setTask = useGenerativeStore((s) =>
    node === 'start' ? s.setStartImageTask : s.setEndImageTask,
  );

  const { startPolling, cancel } = useTaskPolling(setTask);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    const response = await submitImageGeneration({
      prompt: prompt.trim(),
      size: imageSize,
      quality: imageQuality,
    });

    const resultUrl = await startPolling(response.id, (signal) =>
      getImageTaskDetail(response.id, signal),
    );

    if (resultUrl) {
      onImageGenerated({ type: 'generated', url: resultUrl, prompt: prompt.trim() });
      setOpen(false);
      setPrompt('');
    }
  }, [prompt, imageSize, imageQuality, startPolling, onImageGenerated]);

  const isGenerating = task.status === 'pending' || task.status === 'processing';
  const configured = isEvolinkConfigured();

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        disabled={!configured}
        onClick={() => setOpen(true)}
        data-tooltip={configured ? 'Generate with AI' : 'Set API key in Settings first'}
      >
        <Sparkles className="mr-1 h-3 w-3" />
        AI Generate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate {node === 'start' ? 'Start' : 'End'} Image</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="img-prompt">Prompt</Label>
            <Textarea
              id="img-prompt"
              placeholder="Describe the image you want to generate..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              rows={3}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label>Size</Label>
              <Select
                value={imageSize}
                onValueChange={(v) => setImageSize(v as NanobananaSize)}
                disabled={isGenerating}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <Label>Quality</Label>
              <Select
                value={imageQuality}
                onValueChange={(v) => setImageQuality(v as NanobananaQuality)}
                disabled={isGenerating}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isGenerating ? (
            <GenerationProgress task={task} label="Image" onCancel={cancel} />
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate Image
            </Button>
          )}

          {task.status === 'failed' && task.error && (
            <p className="text-xs text-destructive">{task.error}</p>
          )}
        </div>
      </DialogContent>
      </Dialog>
    </>
  );
});
