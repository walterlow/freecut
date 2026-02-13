import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';

interface ExportPreviewPlayerProps {
  src: string;
  isVideo: boolean;
}

function formatMediaTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ExportPreviewPlayer({ src, isVideo }: ExportPreviewPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [isMuted, setIsMuted] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  isSeekingRef.current = isSeeking;

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const handleSeek = useCallback((values: number[]) => {
    const el = mediaRef.current;
    if (!el || !duration) return;
    const time = ((values[0] ?? 0) / 100) * duration;
    el.currentTime = time;
    setCurrentTime(time);
  }, [duration]);

  const handleVolumeChange = useCallback((values: number[]) => {
    const el = mediaRef.current;
    if (!el) return;
    const v = (values[0] ?? 75) / 100;
    el.volume = v;
    setVolume(v);
    if (v > 0 && isMuted) {
      el.muted = false;
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    const newMuted = !el.muted;
    el.muted = newMuted;
    setIsMuted(newMuted);
  }, []);

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el || !isVideo) return;
    if (el.requestFullscreen) {
      void el.requestFullscreen();
    }
  }, [isVideo]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = volume;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime);
    };
    const onLoadedMetadata = () => setDuration(el.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(el.duration);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('ended', onEnded);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('ended', onEnded);
    };
  }, [volume]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={containerRef} className="rounded-lg border border-border overflow-hidden bg-secondary/30">
      {/* Media element */}
      {isVideo ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={src}
          className="w-full max-h-[280px] object-contain bg-background cursor-pointer"
          onClick={togglePlay}
          preload="metadata"
        />
      ) : (
        <div className="flex items-center justify-center py-8 bg-secondary/30">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Volume2 className="w-7 h-7 text-primary" />
          </div>
          <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={src} preload="metadata" />
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 border-t border-border">
        {/* Play/Pause */}
        <Button
          size="icon"
          className="h-8 w-8 glow-primary-sm flex-shrink-0"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </Button>

        {/* Timecode */}
        <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums flex-shrink-0 select-none">
          <span className="text-primary font-semibold">{formatMediaTime(currentTime)}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-muted-foreground">{formatMediaTime(duration)}</span>
        </div>

        {/* Seek bar */}
        <Slider
          value={[progressPercent]}
          onValueChange={(values) => {
            setIsSeeking(true);
            handleSeek(values);
          }}
          onValueCommit={() => setIsSeeking(false)}
          max={100}
          step={0.1}
          className="flex-1 min-w-0 py-2"
          aria-label="Seek"
        />

        {/* Volume */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            onValueChange={handleVolumeChange}
            max={100}
            step={1}
            className="w-16"
            aria-label="Volume"
          />
        </div>

        {/* Fullscreen (video only) */}
        {isVideo && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleFullscreen}
            aria-label="Fullscreen"
          >
            <Maximize className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
