import { memo, useCallback } from 'react';
import { Clapperboard, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useGenerativeStore } from '../stores/generative-store';
import { useTaskPolling } from '../hooks/use-task-polling';
import { submitVideoGeneration, getVideoTaskDetail } from '../services/seedance-service';
import { ensurePublicUrl } from '../services/image-upload-service';
import { isEvolinkConfigured } from '../services/evolink-client';
import type { SeedanceSpeed, SeedanceQuality, SeedanceAspectRatio } from '../types';

const ASPECT_OPTIONS: { value: SeedanceAspectRatio; label: string }[] = [
  { value: 'adaptive', label: 'Auto' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
];

export const RenderControls = memo(function RenderControls() {
  const startImage = useGenerativeStore((s) => s.startImage);
  const endImage = useGenerativeStore((s) => s.endImage);
  const prompt = useGenerativeStore((s) => s.prompt);
  const videoTask = useGenerativeStore((s) => s.videoTask);
  const setVideoTask = useGenerativeStore((s) => s.setVideoTask);
  const setResultVideoUrl = useGenerativeStore((s) => s.setResultVideoUrl);

  const seedanceSpeed = useGenerativeStore((s) => s.seedanceSpeed);
  const duration = useGenerativeStore((s) => s.duration);
  const quality = useGenerativeStore((s) => s.quality);
  const aspectRatio = useGenerativeStore((s) => s.aspectRatio);
  const generateAudio = useGenerativeStore((s) => s.generateAudio);

  const setSeedanceSpeed = useGenerativeStore((s) => s.setSeedanceSpeed);
  const setDuration = useGenerativeStore((s) => s.setDuration);
  const setQuality = useGenerativeStore((s) => s.setQuality);
  const setAspectRatio = useGenerativeStore((s) => s.setAspectRatio);
  const setGenerateAudio = useGenerativeStore((s) => s.setGenerateAudio);

  const { startPolling, cancel } = useTaskPolling(setVideoTask);

  const isGenerating = videoTask.status === 'pending' || videoTask.status === 'processing';
  const canGenerate = !!startImage && !!prompt.trim() && isEvolinkConfigured() && !isGenerating;

  const handleGenerate = useCallback(async () => {
    if (!startImage || !prompt.trim()) return;

    try {
      // Convert local images to public URLs
      const imageUrls: string[] = [];
      imageUrls.push(await ensurePublicUrl(startImage));
      if (endImage) {
        imageUrls.push(await ensurePublicUrl(endImage));
      }

      setResultVideoUrl(null);

      const response = await submitVideoGeneration({
        prompt: prompt.trim(),
        imageUrls,
        speed: seedanceSpeed,
        duration,
        quality,
        aspectRatio,
        generateAudio,
      });

      const resultUrl = await startPolling(response.id, (signal) =>
        getVideoTaskDetail(response.id, signal),
      );

      if (resultUrl) {
        setResultVideoUrl(resultUrl);
        toast.success('Video generated successfully');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start generation';
      toast.error(message);
      setVideoTask({ status: 'failed', error: message });
    }
  }, [
    startImage,
    endImage,
    prompt,
    seedanceSpeed,
    duration,
    quality,
    aspectRatio,
    generateAudio,
    startPolling,
    setResultVideoUrl,
    setVideoTask,
  ]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Settings row */}
      <div className="flex w-full flex-wrap items-end justify-center gap-3 px-2 sm:w-auto sm:px-0">
        {/* Speed */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Speed</Label>
          <Select
            value={seedanceSpeed}
            onValueChange={(v) => setSeedanceSpeed(v as SeedanceSpeed)}
            disabled={isGenerating}
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="fast">
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Fast
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Duration */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Duration: {duration}s</Label>
          <Slider
            value={[duration]}
            onValueChange={([v]) => setDuration(v)}
            min={4}
            max={15}
            step={1}
            disabled={isGenerating}
            className="w-28"
          />
        </div>

        {/* Quality */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Quality</Label>
          <Select
            value={quality}
            onValueChange={(v) => setQuality(v as SeedanceQuality)}
            disabled={isGenerating}
          >
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="480p">480p</SelectItem>
              <SelectItem value="720p">720p</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Aspect Ratio */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Ratio</Label>
          <Select
            value={aspectRatio}
            onValueChange={(v) => setAspectRatio(v as SeedanceAspectRatio)}
            disabled={isGenerating}
          >
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Audio */}
        <div className="flex flex-col items-center gap-1">
          <Label className="text-xs">Audio</Label>
          <Switch
            checked={generateAudio}
            onCheckedChange={setGenerateAudio}
            disabled={isGenerating}
          />
        </div>
      </div>

      {/* Generate button */}
      <Button
        onClick={isGenerating ? cancel : handleGenerate}
        disabled={!isGenerating && !canGenerate}
        variant={isGenerating ? 'destructive' : 'default'}
        className="min-w-[140px] sm:min-w-[160px]"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Cancel
          </>
        ) : (
          <>
            <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
            Generate Video
          </>
        )}
      </Button>
    </div>
  );
});
