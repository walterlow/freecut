import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Info,
  Loader2,
  Pause,
  Play,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { SliderInput } from '@/shared/ui/property-controls';
import {
  getStoredTtsEngine,
  getStoredTtsQuality,
  setStoredTtsEngine,
  setStoredTtsQuality,
  type StoredTtsEngine,
} from '@/shared/utils/tts-settings';
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  linkItems,
} from '@/features/editor/deps/timeline-utils';
import { useTtsGenerateDialogStore } from '@/app/state/tts-generate-dialog';
import type { AudioItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import {
  KOKORO_TTS_MODEL_OPTIONS,
  KOKORO_TTS_VOICE_OPTIONS,
  kokoroTtsService,
  type KokoroTtsModel,
  type KokoroTtsVoice,
} from '@/features/editor/services/kokoro-tts-service';
import {
  MOSS_TTS_SUPPORTED_LANGUAGES,
  MOSS_TTS_VOICE_OPTIONS,
  getMossTtsVoiceOption,
  mossTtsService,
  type MossTtsVoice,
} from '@/features/editor/services/moss-tts-service';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Insert an audio item aligned to the source text item's position,
 * then link the two together.
 */
function insertAndLinkAudioAtTextItem(
  media: MediaMetadata,
  blobUrl: string,
  sourceItemId: string,
): { inserted: boolean; audioItemId: string | null } {
  const { tracks, items, fps, addItem } = useTimelineStore.getState();
  const sourceItem = items.find((i) => i.id === sourceItemId);
  if (!sourceItem) return { inserted: false, audioItemId: null };

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: null,
  });

  if (!targetTrack) return { inserted: false, audioItemId: null };

  const sourceFps = media.fps || fps;
  const durationInFrames = Math.max(1, Math.round(media.duration * fps));
  const sourceDurationFrames = Math.round(media.duration * sourceFps);

  // Place at the text item's start position, nudging if occupied
  const finalPosition =
    findNearestAvailableSpace(sourceItem.from, durationInFrames, targetTrack.id, items) ??
    sourceItem.from;

  const audioItemId = crypto.randomUUID();
  const audioItem: AudioItem = {
    id: audioItemId,
    type: 'audio',
    trackId: targetTrack.id,
    from: finalPosition,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: sourceDurationFrames,
    sourceDuration: sourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  };

  addItem(audioItem);

  const added = useTimelineStore.getState().items.some((i) => i.id === audioItemId);
  if (!added) return { inserted: false, audioItemId: null };

  // Link the text item and audio item (linkItems also updates selection)
  linkItems([sourceItemId, audioItemId]);

  return { inserted: true, audioItemId };
}

// --- Mini audio player for previewing the result ---

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  isSeekingRef.current = isSeeking;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime);
    };
    const onLoaded = () => setDuration(el.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      el.currentTime = 0;
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);

    return () => {
      el.pause();
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const handleSeek = useCallback((values: number[]) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const time = ((values[0] ?? 0) / 100) * duration;
    el.currentTime = time;
    setCurrentTime(time);
  }, [duration]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying
          ? <Pause className="h-3 w-3" />
          : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true);
          handleSeek(values);
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label="Seek"
      />
      <span className="shrink-0 select-none font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground/40"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  );
});

// --- Main dialog ---

interface GenerationResult {
  file: File;
  objectUrl: string;
  duration: number;
  voice: string;
  model: string;
  tags: string[];
}

export const TtsGenerateDialog = memo(function TtsGenerateDialog() {
  const isOpen = useTtsGenerateDialogStore((s) => s.isOpen);
  const initialText = useTtsGenerateDialogStore((s) => s.initialText);
  const sourceItemId = useTtsGenerateDialogStore((s) => s.sourceItemId);
  const close = useTtsGenerateDialogStore((s) => s.close);

  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId);
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems);
  const showNotification = useMediaLibraryStore((state) => state.showNotification);

  const [text, setText] = useState('');
  const [engine, setEngine] = useState<StoredTtsEngine>(() => getStoredTtsEngine());
  const [kokoroVoice, setKokoroVoice] = useState<KokoroTtsVoice>('af_heart');
  const [mossVoice, setMossVoice] = useState<MossTtsVoice>('Xiaoyu');
  const [model, setModel] = useState<KokoroTtsModel>(() => getStoredTtsQuality());
  const [speed, setSpeed] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [inserted, setInserted] = useState(false);

  const resultUrlRef = useRef<string | null>(null);
  const sessionIdRef = useRef(0);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      sessionIdRef.current++;
      // Revoke previous result URL if not inserted
      if (resultUrlRef.current && !inserted) {
        URL.revokeObjectURL(resultUrlRef.current);
        resultUrlRef.current = null;
      }
      setText(initialText);
      setEngine(getStoredTtsEngine());
      setModel(getStoredTtsQuality());
      setError(null);
      setProgress(null);
      setResult(null);
      setInserted(false);
    }
  }, [isOpen, initialText]);

  useEffect(() => {
    setStoredTtsQuality(model);
  }, [model]);

  useEffect(() => {
    setStoredTtsEngine(engine);
  }, [engine]);

  // Cleanup blob URL when dialog closes
  useEffect(() => {
    if (!isOpen && resultUrlRef.current) {
      // Don't revoke if we inserted — the timeline item references it
      if (!inserted) {
        URL.revokeObjectURL(resultUrlRef.current);
      }
      resultUrlRef.current = null;
    }
  }, [isOpen, inserted]);

  const isKokoroSupported = kokoroTtsService.isSupported();
  const isMossSupported = mossTtsService.isSupported();
  const supportsNativeSpeed = engine === 'kokoro';
  const effectiveSpeed = supportsNativeSpeed ? speed : 1;
  const isTtsSupported = engine === 'kokoro' ? isKokoroSupported : isMossSupported;
  const trimmedText = text.trim();
  const voice = engine === 'kokoro' ? kokoroVoice : mossVoice;
  const mossLanguagesLabel = MOSS_TTS_SUPPORTED_LANGUAGES.join(', ');

  const handleGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setError('Open a project before generating audio.');
      return;
    }
    if (!trimmedText) {
      setError('Enter some text to synthesize.');
      return;
    }
    if (!isTtsSupported) {
      setError(
        engine === 'kokoro'
          ? 'WebGPU is required for Kokoro TTS. Try Chrome 113+, Edge 113+, or Safari 26+.'
          : 'Browser-managed storage is required for MOSS multilingual TTS. Try a recent Chromium browser.',
      );
      return;
    }

    // Clean up previous result
    if (resultUrlRef.current && !inserted) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }

    setError(null);
    setResult(null);
    setInserted(false);
    setIsGenerating(true);
    setProgress('Preparing local TTS...');

    const thisSession = sessionIdRef.current;

    try {
      const result = engine === 'kokoro'
        ? await kokoroTtsService.generateSpeechFile({
          text: trimmedText,
          voice: kokoroVoice,
          speed: effectiveSpeed,
          model,
          onProgress: (msg) => {
            if (sessionIdRef.current === thisSession) setProgress(msg);
          },
        })
        : await mossTtsService.generateSpeechFile({
          text: trimmedText,
          voice: mossVoice,
          speed: effectiveSpeed,
          onProgress: (msg) => {
            if (sessionIdRef.current === thisSession) setProgress(msg);
          },
        });

      const { blob, file, duration } = result;

      if (sessionIdRef.current !== thisSession) {
        // Dialog was closed/reopened — discard stale result
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      resultUrlRef.current = objectUrl;

      const voiceLabel = engine === 'kokoro'
        ? KOKORO_TTS_VOICE_OPTIONS.find((option) => option.value === kokoroVoice)?.label ?? kokoroVoice
        : getMossTtsVoiceOption(mossVoice).label;
      const modelLabel = engine === 'kokoro'
        ? KOKORO_TTS_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
        : 'Multilingual Nano';
      const tags = engine === 'kokoro'
        ? [
          'ai-generated',
          'kokoro-tts',
          'tts-engine:kokoro',
          `kokoro-quality:${model}`,
          `kokoro-voice:${kokoroVoice}`,
        ]
        : [
          'ai-generated',
          'moss-tts',
          'tts-engine:moss',
          `moss-voice:${mossVoice}`,
        ];

      setResult({ file, objectUrl, duration, voice: voiceLabel, model: modelLabel, tags });
      setProgress(null);
    } catch (generationError) {
      if (sessionIdRef.current !== thisSession) return;
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Failed to generate speech.'
      );
      setProgress(null);
    } finally {
      if (sessionIdRef.current === thisSession) {
        setIsGenerating(false);
      }
    }
  }, [currentProjectId, effectiveSpeed, engine, inserted, isTtsSupported, kokoroVoice, model, mossVoice, trimmedText]);

  const handleInsert = useCallback(async () => {
    if (!result || !currentProjectId || !sourceItemId) return;

    setIsInserting(true);
    setError(null);

    try {
      const { mediaLibraryService } = await importMediaLibraryService();
      const media = await mediaLibraryService.importGeneratedAudio(result.file, currentProjectId, {
        tags: result.tags,
      });

      await loadMediaItems();

      const { inserted: didInsert } = insertAndLinkAudioAtTextItem(
        media,
        result.objectUrl,
        sourceItemId,
      );

      if (didInsert) {
        setInserted(true);
        showNotification({
          type: 'success',
          message: `Added "${media.fileName}" to timeline and linked with text.`,
        });
      } else {
        showNotification({
          type: 'warning',
          message: `Saved "${media.fileName}" but no audio track is available.`,
        });
      }
    } catch (insertError) {
      setError(
        insertError instanceof Error
          ? insertError.message
          : 'Failed to save and insert audio.'
      );
    } finally {
      setIsInserting(false);
    }
  }, [result, currentProjectId, sourceItemId, loadMediaItems, showNotification]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) close();
  }, [close]);

  const canGenerate = !isGenerating && !isInserting && !!trimmedText && !!currentProjectId && isTtsSupported;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <WandSparkles className="h-4 w-4" />
            Generate Audio from Text
          </DialogTitle>
          <DialogDescription className="text-xs">
            Generate speech and insert it at the text clip's position.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isTtsSupported && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              {engine === 'kokoro'
                ? 'WebGPU is not available in this browser. Kokoro TTS needs Chrome 113+, Edge 113+, or Safari 26+.'
                : 'Browser-managed storage is not available in this browser. MOSS multilingual TTS works best in a recent Chromium browser.'}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label>Engine</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="TTS engine support details"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 space-y-2 p-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Kokoro</p>
                      <p className="text-[11px] text-muted-foreground">English voices on WebGPU.</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">MOSS Nano</p>
                      <p className="text-[11px] text-muted-foreground">Supported languages: {mossLanguagesLabel}.</p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <Select value={engine} onValueChange={(value) => setEngine(value as StoredTtsEngine)} disabled={isGenerating || isInserting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kokoro" className="text-xs">Kokoro (English, WebGPU)</SelectItem>
                  <SelectItem value="moss" className="text-xs">MOSS Nano (20 languages, CPU)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className={`grid grid-cols-1 gap-3 ${engine === 'kokoro' ? 'md:grid-cols-2' : ''}`}>
              {engine === 'kokoro' && (
                <div className="space-y-1.5">
                  <Label>Quality</Label>
                  <Select value={model} onValueChange={(value) => setModel(value as typeof model)} disabled={isGenerating || isInserting}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KOKORO_TTS_MODEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label} ({option.downloadLabel})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Voice</Label>
                <Select
                  value={voice}
                  onValueChange={(value) => {
                    if (engine === 'kokoro') {
                      setKokoroVoice(value as KokoroTtsVoice);
                    } else {
                      setMossVoice(value as MossTtsVoice);
                    }
                  }}
                  disabled={isGenerating || isInserting}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {(engine === 'kokoro' ? KOKORO_TTS_VOICE_OPTIONS : MOSS_TTS_VOICE_OPTIONS).map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Text input */}
          <div className="space-y-2">
            <Label htmlFor="tts-dialog-text">Text</Label>
            <Textarea
              id="tts-dialog-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Enter the text you want to hear spoken..."
              className="min-h-28 resize-y bg-secondary/30 text-sm"
              disabled={isGenerating || isInserting}
            />
          </div>

          {/* Speed */}
          {supportsNativeSpeed && (
            <SliderInput
              label="Speed"
              value={speed}
              onChange={setSpeed}
              min={0.5}
              max={2}
              step={0.05}
              unit="x"
              disabled={isGenerating || isInserting}
            />
          )}

          {/* Progress */}
          {progress && (
            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
              {progress}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div className={`rounded-xl border p-3 space-y-2 ${
              inserted
                ? 'border-emerald-500/25 bg-emerald-500/5'
                : 'border-border bg-secondary/20'
            }`}>
              <p className="text-[11px] text-muted-foreground">
                {result.voice} Â· {result.model} Â· {result.duration > 0 ? `${result.duration.toFixed(1)}s` : '—'}
              </p>
              <MiniAudioPlayer src={result.objectUrl} />

              {inserted && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Inserted & linked
                </span>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={result && !inserted ? 'secondary' : 'default'}
              onClick={() => { void handleGenerate(); }}
              disabled={!canGenerate}
              className="h-8 gap-1.5"
            >
              {isGenerating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <WandSparkles className="h-3.5 w-3.5" />}
              {isGenerating ? 'Generating...' : result ? 'Regenerate' : 'Generate'}
            </Button>

            {result && !inserted && (
              <Button
                size="sm"
                onClick={() => { void handleInsert(); }}
                disabled={isInserting || isGenerating}
                className="h-8 gap-1.5"
              >
                {isInserting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                {isInserting ? 'Inserting...' : 'Insert & Link'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
