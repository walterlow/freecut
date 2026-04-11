import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  CheckCircle2,
  Download,
  Info,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getMusicgenModelDefinition } from '@/shared/utils/musicgen-models';
import { SliderInput } from '@/shared/ui/property-controls';
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/editor/deps/timeline-utils';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';
import type { AudioItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import {
  KITTEN_TTS_MODEL_OPTIONS,
  KITTEN_TTS_VOICE_OPTIONS,
  kittenTtsService,
  type KittenTtsVoice,
} from '../services/kitten-tts-service';
import {
  DEFAULT_MUSICGEN_MODEL,
  MUSICGEN_MODEL_OPTIONS,
  musicgenService,
  type MusicgenModelId,
} from '../services/musicgen-service';

const DEFAULT_PROMPT = 'Welcome to free cut. This voice was generated locally in the browser with WebGPU.';

const MUSIC_PROMPT_PRESETS = [
  { label: 'Lo-fi Chill', prompt: 'Warm lo-fi beat with dusty drums, mellow bass, and a dreamy synth lead' },
  { label: '80s Pop', prompt: '80s pop track with bassy drums and synth' },
  { label: '90s Rock', prompt: '90s rock song with loud guitars and heavy drums' },
  { label: 'Upbeat EDM', prompt: 'A light and cheery EDM track, with syncopated drums, airy pads, and strong emotions bpm: 130' },
  { label: 'Country', prompt: 'A cheerful country song with acoustic guitars' },
  { label: 'Lo-fi Electro', prompt: 'Lofi slow bpm electro chill with organic samples' },
];

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_MUSIC_PROMPT = MUSIC_PROMPT_PRESETS[0]!.prompt;

interface AudioGeneration {
  id: string;
  file: File;
  objectUrl: string;
  byteSize: number;
  duration: number;
  textSnippet: string;
  voice: string;
  model: string;
  summary: string;
  details: string;
  tags: string[];
  /** null = unsaved, string = saved media ID */
  savedMediaId: string | null;
  saving: boolean;
}

type Generation = AudioGeneration;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

function insertAudioItemAtPlayhead(media: MediaMetadata, blobUrl: string): boolean {
  const { tracks, items, fps, addItem } = useTimelineStore.getState();
  const { activeTrackId, selectItems } = useSelectionStore.getState();

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: activeTrackId,
  });

  if (!targetTrack) return false;

  const sourceFps = media.fps || fps;
  const durationInFrames = Math.max(1, Math.round(media.duration * fps));
  const sourceDurationFrames = Math.round(media.duration * sourceFps);

  const proposedPosition = usePlaybackStore.getState().currentFrame;
  const finalPosition =
    findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
    proposedPosition;

  const audioItem: AudioItem = {
    id: crypto.randomUUID(),
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

  // addItem may silently drop the item if placement fails; verify it landed.
  const added = useTimelineStore.getState().items.some((i) => i.id === audioItem.id);
  if (added) {
    selectItems([audioItem.id]);
  }
  return added;
}

export const AiPanel = memo(function AiPanel() {
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId);
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems);
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia);
  const showNotification = useMediaLibraryStore((state) => state.showNotification);

  const [ttsText, setTtsText] = useState(DEFAULT_PROMPT);
  const [ttsVoice, setTtsVoice] = useState<KittenTtsVoice>('Bella');
  const [ttsModel, setTtsModel] = useState<'nano' | 'micro' | 'mini'>('mini');
  const [ttsSpeed, setTtsSpeed] = useState(1.25);
  const [isTtsGenerating, setIsTtsGenerating] = useState(false);
  const [ttsProgress, setTtsProgress] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsGenerations, setTtsGenerations] = useState<AudioGeneration[]>([]);
  const [ttsInfoOpen, setTtsInfoOpen] = useState(false);

  const [musicPrompt, setMusicPrompt] = useState(DEFAULT_MUSIC_PROMPT);
  const [musicModel] = useState<MusicgenModelId>(DEFAULT_MUSICGEN_MODEL);
  const currentMusicModel = useMemo(() => getMusicgenModelDefinition(musicModel), [musicModel]);
  const [musicDuration, setMusicDuration] = useState(currentMusicModel.defaultDurationSeconds);
  const [isMusicGenerating, setIsMusicGenerating] = useState(false);
  const [musicProgress, setMusicProgress] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicGenerations, setMusicGenerations] = useState<AudioGeneration[]>([]);
  const [musicProgressPct, setMusicProgressPct] = useState<number | null>(null);
  const [musicInfoOpen, setMusicInfoOpen] = useState(false);

  const musicAbortRef = useRef<AbortController | null>(null);
  const generationUrlsRef = useRef<Set<string>>(new Set());

  // Revoke all blob URLs on unmount
  useEffect(() => {
    setMusicDuration((previous) => Math.min(
      currentMusicModel.maxDurationSeconds,
      Math.max(currentMusicModel.minDurationSeconds, previous),
    ));
  }, [currentMusicModel.maxDurationSeconds, currentMusicModel.minDurationSeconds]);

  // Revoke all blob URLs on unmount
  useEffect(() => {
    const urls = generationUrlsRef.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const isTtsSupported = kittenTtsService.isSupported();
  const isMusicSupported = musicgenService.isSupported();
  const trimmedTtsText = ttsText.trim();
  const trimmedMusicPrompt = musicPrompt.trim();
  const recommendedLength = trimmedTtsText.length <= 500;

  const totalTtsBytes = useMemo(
    () => ttsGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [ttsGenerations]
  );

  const totalMusicBytes = useMemo(
    () => musicGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [musicGenerations]
  );

  const anyTtsSaving = ttsGenerations.some((generation) => generation.saving);
  const anyMusicSaving = musicGenerations.some((generation) => generation.saving);
  const text = ttsText;
  const setText = setTtsText;
  const model = ttsModel;
  const setModel = setTtsModel;
  const voice = ttsVoice;
  const setVoice = setTtsVoice;
  const speed = ttsSpeed;
  const setSpeed = setTtsSpeed;
  const isGenerating = isTtsGenerating;
  const progress = ttsProgress;
  const error = ttsError;
  const generations = ttsGenerations;
  const totalBytes = totalTtsBytes;
  const anySaving = anyTtsSaving;
  const trimmedText = trimmedTtsText;
  const isWebGpuSupported = isTtsSupported;

  // --- actions ---

  const handleTtsGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setTtsError('Open a project before generating audio.');
      return;
    }
    if (!trimmedTtsText) {
      setTtsError('Enter some text to synthesize.');
      return;
    }
    if (!isTtsSupported) {
      setTtsError('WebGPU is required for Kitten TTS. Try Chrome 113+, Edge 113+, or Safari 26+.');
      return;
    }

    setTtsError(null);
    setIsTtsGenerating(true);
    setTtsProgress('Preparing local TTS...');

    try {
      const { blob, file, duration } = await kittenTtsService.generateSpeechFile({
        text: trimmedTtsText,
        voice: ttsVoice,
        speed: ttsSpeed,
        model: ttsModel,
        onProgress: setTtsProgress,
      });

      const objectUrl = URL.createObjectURL(blob);
      generationUrlsRef.current.add(objectUrl);

      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedTtsText,
        voice: ttsVoice,
        model: ttsModel,
        summary: trimmedTtsText,
        details: `${ttsVoice} / ${ttsModel} / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: [
          'ai-generated',
          'kitten-tts',
          `kitten-model:${ttsModel}`,
          `kitten-voice:${ttsVoice.toLowerCase()}`,
        ],
        savedMediaId: null,
        saving: false,
      };

      setTtsGenerations((prev) => [generation, ...prev]);
      setTtsProgress(null);
    } catch (generationError) {
      setTtsError(
        generationError instanceof Error
          ? generationError.message
          : 'Failed to generate speech.'
      );
      setTtsProgress(null);
    } finally {
      setIsTtsGenerating(false);
    }
  }, [currentProjectId, trimmedTtsText, isTtsSupported, ttsVoice, ttsSpeed, ttsModel]);

  const handleMusicGenerate = useCallback(async () => {
    if (!currentProjectId) return null;
    if (!trimmedMusicPrompt) {
      setMusicError('Describe the music you want to generate.');
      return null;
    }
    if (!isMusicSupported) {
      setMusicError('WebGPU is required for MusicGen. Try Chrome 113+, Edge 113+, or Safari 26+.');
      return null;
    }

    const abortController = new AbortController();
    musicAbortRef.current = abortController;

    setMusicError(null);
    setIsMusicGenerating(true);
    setMusicProgress('Preparing local music generation...');
    setMusicProgressPct(null);

    try {
      const { blob, file, duration } = await musicgenService.generateMusicFile({
        prompt: trimmedMusicPrompt,
        model: musicModel,
        durationSeconds: musicDuration,
        onProgress: (stage, fraction) => {
          setMusicProgress(stage);
          setMusicProgressPct(fraction ?? null);
        },
        signal: abortController.signal,
      });

      const objectUrl = URL.createObjectURL(blob);
      generationUrlsRef.current.add(objectUrl);

      const modelLabel = MUSICGEN_MODEL_OPTIONS.find((option) => option.value === musicModel)?.label ?? musicModel;
      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedMusicPrompt,
        voice: modelLabel,
        model: `target ${musicDuration}s`,
        summary: trimmedMusicPrompt,
        details: `${modelLabel} / target ${musicDuration}s / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: [
          'ai-generated',
          'musicgen',
          `musicgen-model:${musicModel}`,
          `musicgen-target:${musicDuration}s`,
        ],
        savedMediaId: null,
        saving: false,
      };

      setMusicGenerations((prev) => [generation, ...prev]);
    } catch (generationError) {
      if (generationError instanceof DOMException && generationError.name === 'AbortError') {
        // Intentional cancellation — no error shown.
      } else {
        setMusicError(
          generationError instanceof Error
            ? generationError.message
            : 'Failed to generate music.'
        );
      }
    } finally {
      musicAbortRef.current = null;
      setIsMusicGenerating(false);
      setMusicProgress(null);
      setMusicProgressPct(null);
    }
  }, [currentProjectId, trimmedMusicPrompt, isMusicSupported, musicModel, musicDuration]);

  const handleMusicCancel = useCallback(() => {
    musicAbortRef.current?.abort();
  }, []);

  const updateGenerationInList = useCallback((
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
    id: string,
    patch: Partial<AudioGeneration>,
  ) => {
    setGenerations((prev) => prev.map((generation) => (
      generation.id === id ? { ...generation, ...patch } : generation
    )));
  }, []);

  const saveGeneration = useCallback(async (
    generation: AudioGeneration,
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ): Promise<MediaMetadata | null> => {
    if (!currentProjectId) return null;
    updateGenerationInList(setGenerations, generation.id, { saving: true });

    try {
      const { mediaLibraryService } = await importMediaLibraryService();
      const media = await mediaLibraryService.importGeneratedAudio(generation.file, currentProjectId, {
        tags: generation.tags,
      });

      await loadMediaItems();
      selectMedia([media.id]);
      // Remove from tracked URLs so unmount cleanup won't revoke a URL
      // that may be referenced by a timeline item's src
      generationUrlsRef.current.delete(generation.objectUrl);
      updateGenerationInList(setGenerations, generation.id, { saving: false, savedMediaId: media.id });
      return media;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save audio to the media library.'
      );
      updateGenerationInList(setGenerations, generation.id, { saving: false });
      return null;
    }
  }, [currentProjectId, loadMediaItems, selectMedia, updateGenerationInList]);

  const handleSave = useCallback(async (
    generation: AudioGeneration,
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ) => {
    const media = await saveGeneration(generation, setGenerations, setError);
    if (media) {
      showNotification({
        type: 'success',
        message: `Saved "${media.fileName}" to the media library.`,
      });
    }
  }, [saveGeneration, showNotification]);

  const handleSaveAndInsert = useCallback(async (
    generation: AudioGeneration,
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
    setError: Dispatch<SetStateAction<string | null>>,
  ) => {
    const media = await saveGeneration(generation, setGenerations, setError);
    if (!media) return;

    const inserted = insertAudioItemAtPlayhead(media, generation.objectUrl);
    showNotification({
      type: inserted ? 'success' : 'warning',
      message: inserted
        ? `Saved "${media.fileName}" and added to timeline.`
        : `Saved "${media.fileName}" but no audio track is available.`,
    });
  }, [saveGeneration, showNotification]);

  const removeGenerationFromList = useCallback((
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
    id: string,
  ) => {
    setGenerations((prev) => {
      const generation = prev.find((entry) => entry.id === id);
      if (generation) {
        // Only revoke the blob URL if it has not been saved; saved items may
        // have their blob URL referenced by a timeline audio item's `src`.
        if (!generation.savedMediaId) {
          URL.revokeObjectURL(generation.objectUrl);
          generationUrlsRef.current.delete(generation.objectUrl);
        }
      }
      return prev.filter((entry) => entry.id !== id);
    });
  }, []);

  const clearGenerationList = useCallback((
    setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
  ) => {
    // Only revoke blob URLs for unsaved generations; saved ones may be
    // referenced by timeline items.
    setGenerations((prev) => {
      for (const generation of prev) {
        if (!generation.savedMediaId) {
          URL.revokeObjectURL(generation.objectUrl);
          generationUrlsRef.current.delete(generation.objectUrl);
        }
      }
      return [];
    });
  }, []);

  const handleSaveTtsGeneration = useCallback(
    (generation: AudioGeneration) => handleSave(generation, setTtsGenerations, setTtsError),
    [handleSave],
  );
  const handleSaveAndInsertTtsGeneration = useCallback(
    (generation: AudioGeneration) => handleSaveAndInsert(generation, setTtsGenerations, setTtsError),
    [handleSaveAndInsert],
  );
  const handleGenerate = handleTtsGenerate;
  const handleClearAll = () => clearGenerationList(setTtsGenerations);
  const handleRemoveGeneration = (id: string) => removeGenerationFromList(setTtsGenerations, id);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-4">
        <div className="-mx-3 -mt-3 flex items-center gap-2 bg-secondary/50 px-3 py-2">
          <h2 className="text-sm font-medium">Text to Speech</h2>
          <Popover open={ttsInfoOpen} onOpenChange={setTtsInfoOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="TTS info"
                onMouseEnter={() => setTtsInfoOpen(true)}
                onMouseLeave={() => setTtsInfoOpen(false)}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-64 space-y-2 p-3 text-xs"
              onMouseEnter={() => setTtsInfoOpen(true)}
              onMouseLeave={() => setTtsInfoOpen(false)}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  WebGPU
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Local
                </span>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                Runs entirely in the browser using Kitten TTS on WebGPU. No data is sent to a server.
              </p>
              <table className="w-full text-[11px]">
                <tbody>
                  {KITTEN_TTS_MODEL_OPTIONS.map((opt) => (
                    <tr key={opt.value} className="border-t border-border/50">
                      <td className="py-1 pr-2 font-medium text-foreground">{opt.label}</td>
                      <td className="py-1 pr-2 text-muted-foreground">{opt.qualityLabel}</td>
                      <td className="py-1 text-right text-muted-foreground">{opt.downloadLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="leading-relaxed text-muted-foreground">
                Models are cached after the first download.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {!isTtsSupported && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            WebGPU is not available in this browser. Kitten TTS needs Chrome 113+, Edge 113+, or Safari 26+.
          </div>
        )}

        {/* Text input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-tts-text">Text</Label>
            <span className={`text-[11px] ${recommendedLength ? 'text-muted-foreground' : 'text-amber-400'}`}>
              {trimmedText.length}/500 recommended
            </span>
          </div>
          <Textarea
            id="ai-tts-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Enter the text you want to hear spoken..."
            className="min-h-24 resize-y bg-secondary/30 text-sm"
            disabled={isGenerating}
          />
        </div>

        {/* Model + Voice */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={(value) => setModel(value as typeof model)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KITTEN_TTS_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label} ({option.downloadLabel})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Voice</Label>
            <Select value={voice} onValueChange={(value) => setVoice(value as KittenTtsVoice)} disabled={isGenerating}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KITTEN_TTS_VOICE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Speed + Generate */}
        <div className="flex items-center gap-2">
          <SliderInput
            label="Speed"
            value={speed}
            onChange={setSpeed}
            min={0.5}
            max={2}
            step={0.05}
            unit="x"
            disabled={isGenerating}
          />
          <Button
            size="sm"
            onClick={() => { void handleGenerate(); }}
            disabled={isGenerating || !trimmedText || !currentProjectId || !isWebGpuSupported}
            className="h-7 shrink-0 gap-1.5"
          >
            {isGenerating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <WandSparkles className="h-3.5 w-3.5" />}
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>

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

        {/* Generation history */}
        {generations.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                History ({generations.length}) - {formatBytes(totalBytes)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={handleClearAll}
                disabled={anySaving}
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </Button>
            </div>

            <div className="space-y-2">
              {generations.map((gen) => (
                <GenerationRow
                  key={gen.id}
                  generation={gen}
                  onSave={handleSaveTtsGeneration}
                  onSaveAndInsert={handleSaveAndInsertTtsGeneration}
                  onRemove={handleRemoveGeneration}
                />
              ))}
            </div>
          </div>
        )}

        <div className="-mx-3 flex items-center gap-2 bg-secondary/50 px-3 py-2">
          <h2 className="text-sm font-medium">Music Generation</h2>
          <Popover open={musicInfoOpen} onOpenChange={setMusicInfoOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Music generation info"
                onMouseEnter={() => setMusicInfoOpen(true)}
                onMouseLeave={() => setMusicInfoOpen(false)}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-72 space-y-2 p-3 text-xs"
              onMouseEnter={() => setMusicInfoOpen(true)}
              onMouseLeave={() => setMusicInfoOpen(false)}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  WebGPU
                </span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Local
                </span>
              </div>
              <p className="leading-relaxed text-muted-foreground">
                Uses Xenova&apos;s browser-ready MusicGen model through Transformers.js. The first download is large, then it stays cached locally.
              </p>
              <table className="w-full text-[11px]">
                <tbody>
                  {MUSICGEN_MODEL_OPTIONS.map((option) => (
                    <tr key={option.value} className="border-t border-border/50">
                      <td className="py-1 pr-2 font-medium text-foreground">{option.label}</td>
                      <td className="py-1 text-right text-muted-foreground">{option.downloadLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="leading-relaxed text-muted-foreground">
                Prompt with genre, mood, tempo, and instrumentation. Shorter clips finish much faster.
              </p>
            </PopoverContent>
          </Popover>
        </div>

        {!isMusicSupported && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            WebGPU is not available in this browser. MusicGen needs Chrome 113+, Edge 113+, or Safari 26+.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-music-prompt">Prompt</Label>
            <Select
              value=""
              onValueChange={(value) => setMusicPrompt(value)}
              disabled={isMusicGenerating}
            >
              <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:text-foreground">
                <SelectValue placeholder="Presets" />
              </SelectTrigger>
              <SelectContent align="end">
                {MUSIC_PROMPT_PRESETS.map((preset) => (
                  <SelectItem key={preset.label} value={preset.prompt} className="text-xs">
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            id="ai-music-prompt"
            value={musicPrompt}
            onChange={(event) => setMusicPrompt(event.target.value)}
            placeholder="Describe the kind of music you want to generate..."
            className="min-h-24 resize-y bg-secondary/30 text-sm"
            disabled={isMusicGenerating}
          />
        </div>

        <SliderInput
          label="Length"
          value={musicDuration}
          onChange={(value) => setMusicDuration(Math.round(value))}
          min={currentMusicModel.minDurationSeconds}
          max={currentMusicModel.maxDurationSeconds}
          step={1}
          unit="s"
          disabled={isMusicGenerating}
        />

        <div className="flex items-center justify-end gap-2">
          {isMusicGenerating && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMusicCancel}
              className="h-7 shrink-0 gap-1.5 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => { void handleMusicGenerate(); }}
            disabled={isMusicGenerating || !trimmedMusicPrompt || !currentProjectId || !isMusicSupported}
            className="h-7 shrink-0 gap-1.5"
          >
            {isMusicGenerating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <WandSparkles className="h-3.5 w-3.5" />}
            {isMusicGenerating ? 'Generating...' : 'Generate Music'}
          </Button>
        </div>

        {musicProgress && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">{musicProgress}</p>
            {musicProgressPct != null && (
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
                  style={{ width: `${Math.round(musicProgressPct * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {musicError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {musicError}
          </div>
        )}

        {musicGenerations.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Music History ({musicGenerations.length}) - {formatBytes(totalMusicBytes)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={() => clearGenerationList(setMusicGenerations)}
                disabled={anyMusicSaving}
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </Button>
            </div>

            <div className="space-y-2">
              {musicGenerations.map((generation) => (
                <GenerationRow
                  key={generation.id}
                  generation={generation}
                  onSave={(entry) => handleSave(entry, setMusicGenerations, setMusicError)}
                  onSaveAndInsert={(entry) => handleSaveAndInsert(entry, setMusicGenerations, setMusicError)}
                  onRemove={(id) => removeGenerationFromList(setMusicGenerations, id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// --- Row component ---

const GenerationRow = memo(function GenerationRow({
  generation: gen,
  onSave,
  onSaveAndInsert,
  onRemove,
}: {
  generation: Generation;
  onSave: (gen: Generation) => Promise<void>;
  onSaveAndInsert: (gen: Generation) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const saved = gen.savedMediaId !== null;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      saved
        ? 'border-emerald-500/25 bg-emerald-500/5'
        : 'border-border bg-secondary/20'
    }`}>
      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-3 text-xs leading-relaxed" title={gen.textSnippet}>
            {gen.textSnippet}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {gen.voice} / {gen.model} / {gen.duration > 0 ? `${gen.duration.toFixed(1)}s` : '-'} / {formatBytes(gen.byteSize)}
          </p>
        </div>
        {!gen.saving && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(gen.id)}
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Audio player */}
      <MiniAudioPlayer src={gen.objectUrl} />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            Saved
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => { void onSaveAndInsert(gen); }}
              disabled={gen.saving}
            >
              {gen.saving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <ListPlus className="h-3 w-3" />}
              {gen.saving ? 'Saving...' : 'Save & Insert'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => { void onSave(gen); }}
              disabled={gen.saving}
            >
              <Download className="h-3 w-3" />
              Save to Library
            </Button>
          </>
        )}
      </div>
    </div>
  );
});
