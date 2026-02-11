import { useRef, useEffect } from 'react';
import { AbsoluteFill } from '@/features/player/composition';
import { useBridgedTimelineContext } from '@/features/player/clock';
import { useVideoConfig } from '@/features/player/video-config';
import { FileAudio } from 'lucide-react';

interface SourceCompositionProps {
  src: string;
  mediaType: 'video' | 'audio' | 'image';
  fileName: string;
}

export function SourceComposition({ src, mediaType, fileName }: SourceCompositionProps) {
  if (mediaType === 'video') {
    return <VideoSource src={src} />;
  }
  if (mediaType === 'image') {
    return <ImageSource src={src} />;
  }
  return <AudioSource src={src} fileName={fileName} />;
}

function VideoSource({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { frame, playing, playbackRate } = useBridgedTimelineContext();
  const { fps } = useVideoConfig();
  const lastFrameRef = useRef(frame);

  // Sync video currentTime — always when paused, on seeks when playing
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const frameDelta = Math.abs(frame - lastFrameRef.current);
    lastFrameRef.current = frame;

    const canSeek = video.readyState >= 1;
    if (canSeek && (!playing || frameDelta > 1)) {
      try {
        video.currentTime = frame / fps;
      } catch {
        // Ignore seek errors while media is loading
      }
    }
  }, [frame, playing, src, fps]);

  // Handle play/pause sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (playing) {
      video.playbackRate = playbackRate;
      if (video.readyState >= 1) {
        try {
          video.currentTime = lastFrameRef.current / fps;
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, playbackRate, src, fps]);

  return (
    <AbsoluteFill>
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        playsInline
      />
    </AbsoluteFill>
  );
}

function ImageSource({ src }: { src: string }) {
  return (
    <AbsoluteFill>
      <img
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        alt="Source preview"
      />
    </AbsoluteFill>
  );
}

function AudioSource({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { frame, playing, playbackRate } = useBridgedTimelineContext();
  const { fps } = useVideoConfig();
  const lastFrameRef = useRef(frame);

  // Sync audio currentTime — always when paused, on seeks when playing
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const frameDelta = Math.abs(frame - lastFrameRef.current);
    lastFrameRef.current = frame;

    const canSeek = audio.readyState >= 1;
    if (canSeek && (!playing || frameDelta > 1)) {
      try {
        audio.currentTime = frame / fps;
      } catch {
        // Ignore seek errors while media is loading
      }
    }
  }, [frame, playing, src, fps]);

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (playing) {
      audio.playbackRate = playbackRate;
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = lastFrameRef.current / fps;
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, playbackRate, src, fps]);

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <FileAudio style={{ width: 48, height: 48, color: '#22c55e' }} />
        <span style={{ color: '#a1a1aa', fontSize: 14, maxWidth: 200, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
      </div>
      <audio ref={audioRef} src={src} preload="auto" />
    </AbsoluteFill>
  );
}
