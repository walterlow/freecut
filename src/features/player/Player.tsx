/**
 * Player.tsx - Main Player Component for FreeCut
 * 
 * A customizable video player component inspired by Composition Player
 * with support for:
 * - Frame-accurate playback
 * - Custom controls
 * - Fullscreen mode
 * - Event emission for external integration
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react';
import {
  PlayerEmitterProvider,
  usePlayerEmitter,
  type PlayerEventTypes,
  type CallbackListener,
} from './event-emitter';
import {
  ClockBridgeProvider,
  useBridgedTimelineContext,
} from './clock';
import { usePlayer } from './use-player';
import { VideoConfigProvider } from './video-config-context';

// Types
interface PlayerProps {
  /** The component to render as video content */
  children: React.ReactNode;
  
  /** Duration in frames */
  durationInFrames: number;
  
  /** Frames per second */
  fps: number;
  
  /** Initial frame to start at */
  initialFrame?: number;
  
  /** Whether to loop playback */
  loop?: boolean;
  
  /** Whether to show controls */
  controls?: boolean;
  
  /** Whether to auto-play on mount */
  autoPlay?: boolean;
  
  /** Whether to start muted */
  initiallyMuted?: boolean;
  
  /** Playback rate (0.25 - 4) */
  playbackRate?: number;
  
  /** Custom class name */
  className?: string;
  
  /** Custom styles */
  style?: React.CSSProperties;
  
  /** Width of the player */
  width?: number;
  
  /** Height of the player */
  height?: number;
  
  /** Callback when playback ends */
  onEnded?: () => void;
  
  /** Callback when frame changes */
  onFrameChange?: (frame: number) => void;
  
  /** Callback when play state changes */
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export interface PlayerRef {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (frame: number) => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
  removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
}

/**
 * Default Play/Pause Button Component
 */
const DefaultPlayPauseButton: React.FC<{
  isPlaying: boolean;
  onToggle: () => void;
}> = ({ isPlaying, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      className="p-2 rounded-full hover:bg-white/20 transition-colors"
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );
};

/**
 * Default Progress Bar Component
 */
const DefaultProgressBar: React.FC<{
  currentFrame: number;
  durationInFrames: number;
  seek: (frame: number) => void;
}> = ({ currentFrame, durationInFrames, seek }) => {
  const progress = durationInFrames > 0 ? (currentFrame / durationInFrames) * 100 : 0;
  
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const frame = Math.round(percentage * durationInFrames);
    seek(Math.max(0, Math.min(frame, durationInFrames - 1)));
  };
  
  return (
    <div
      className="w-full h-2 bg-white/20 rounded cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <div
        className="h-full bg-primary transition-none"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

/**
 * Default Controls Component
 */
const DefaultControls: React.FC<{
  isPlaying: boolean;
  currentFrame: number;
  durationInFrames: number;
  fps: number;
  playbackRate: number;
  isFullscreen: boolean;
  onTogglePlay: () => void;
  onSeek: (frame: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onToggleFullscreen: () => void;
}> = ({
  isPlaying,
  currentFrame,
  durationInFrames,
  fps,
  playbackRate,
  isFullscreen,
  onTogglePlay,
  onSeek,
  onPlaybackRateChange,
  onToggleFullscreen,
}) => {
  const formatTime = (frame: number) => {
    const seconds = frame / fps;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
      <div className="mb-3">
        <DefaultProgressBar
          currentFrame={currentFrame}
          durationInFrames={durationInFrames}
          seek={onSeek}
        />
      </div>
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DefaultPlayPauseButton
            isPlaying={isPlaying}
            onToggle={onTogglePlay}
          />
          
          <span className="text-sm text-white ml-2">
            {formatTime(currentFrame)} / {formatTime(durationInFrames - 1)}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <select
            value={playbackRate}
            onChange={(event) => {
              onPlaybackRateChange(Number(event.target.value));
            }}
            className="bg-transparent text-sm text-white border border-white/30 rounded px-2 py-1"
            aria-label="Playback rate"
          >
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          
          <button
            onClick={onToggleFullscreen}
            className="p-2 rounded-full hover:bg-white/20 transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Inner Player Component
 */
const PlayerInner = forwardRef<PlayerRef, PlayerProps>(
  (
    {
      children,
      durationInFrames,
      fps,
      initialFrame = 0,
      loop = false,
      controls = true,
      autoPlay = false,
      initiallyMuted = false,
      playbackRate: initialPlaybackRate = 1,
      className,
      style,
      width = 1280,
      height = 720,
      onEnded,
      onFrameChange,
      onPlayStateChange,
    },
    ref,
  ) => {
    // Consume unused props to avoid lint warnings
    void initiallyMuted;
    void initialPlaybackRate;
    void onEnded;

    // State
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    // Measure container size for scaling
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });

      observer.observe(container);
      // Initial measurement
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });

      return () => observer.disconnect();
    }, []);
    
    // Get player methods
    const player = usePlayer(durationInFrames, { loop, onEnded });
    
    // Get context values
    const {
      frame: currentFrame,
      playing,
      playbackRate,
      setPlaybackRate,
    } = useBridgedTimelineContext();
    const emitter = usePlayerEmitter();
    
    // Sync initial frame
    useEffect(() => {
      if (initialFrame > 0 && currentFrame === 0) {
        player.seek(initialFrame);
      }
    }, [initialFrame, currentFrame, player]);
    
    // Sync autoPlay
    useEffect(() => {
      if (autoPlay && !playing) {
        player.play();
      }
    }, [autoPlay, playing, player]);
    
    // Handle frame changes
    useEffect(() => {
      onFrameChange?.(currentFrame);
    }, [currentFrame, onFrameChange]);
    
    // Handle play state changes
    useEffect(() => {
      onPlayStateChange?.(playing);
    }, [playing, onPlayStateChange]);
    
    // Fullscreen handling
    const toggleFullscreen = useCallback(async () => {
      if (!containerRef.current) return;
      
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    }, []);
    
    // Listen for fullscreen changes
    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };
      
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      return () => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
      };
    }, []);
    
    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        play: () => player.play(),
        pause: () => player.pause(),
        toggle: () => player.toggle(),
        seekTo: (frame: number) => player.seek(frame),
        getCurrentFrame: () => player.getCurrentFrame(),
        isPlaying: () => player.isPlaying(),
        addEventListener: (event, callback) => {
          emitter.addEventListener(event, callback);
        },
        removeEventListener: (event, callback) => {
          emitter.removeEventListener(event, callback);
        },
      }),
      [player, emitter],
    );
    
    return (
      <div
        ref={containerRef}
        className={`relative bg-black ${className || ''}`}
        style={{
          ...style,
          overflow: 'hidden',
        }}
        data-player-container
      >
        {/* Video content - canvas rendered at native size, scaled to fit via CSS */}
        {(() => {
          const scale = containerSize.width > 0 && containerSize.height > 0
            ? Math.min(containerSize.width / width, containerSize.height / height)
            : 1;
          const scaledWidth = width * scale;
          const scaledHeight = height * scale;
          return (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: scaledWidth,
                height: scaledHeight,
                marginLeft: -scaledWidth / 2,
                marginTop: -scaledHeight / 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width,
                  height,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {children}
              </div>
            </div>
          );
        })()}
        
        {/* Controls overlay */}
        {controls && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 pointer-events-auto">
              <DefaultControls
                isPlaying={playing}
                currentFrame={currentFrame}
                durationInFrames={durationInFrames}
                fps={fps}
                playbackRate={playbackRate}
                isFullscreen={isFullscreen}
                onTogglePlay={player.toggle}
                onSeek={player.seek}
                onPlaybackRateChange={setPlaybackRate}
                onToggleFullscreen={toggleFullscreen}
              />
            </div>
            
            {/* Click to play/pause overlay */}
            <div
              className="absolute inset-0 pointer-events-auto cursor-pointer"
              onClick={() => player.toggle()}
            />
          </div>
        )}
      </div>
    );
  },
);

/**
 * Player Component - Main export
 *
 * Now uses the Clock system internally for timing control.
 * The ClockBridgeProvider maintains backwards compatibility with
 * existing code that uses useTimelineContext().
 */
export const Player = forwardRef<PlayerRef, PlayerProps>(
  (props, ref) => {
    const {
      durationInFrames,
      fps,
      initialFrame,
      initiallyMuted,
      playbackRate,
      loop,
      onEnded,
    } = props;

    return (
      <PlayerEmitterProvider>
        <ClockBridgeProvider
          fps={fps}
          durationInFrames={durationInFrames}
          initialFrame={initialFrame}
          initiallyMuted={initiallyMuted}
          initialPlaybackRate={playbackRate}
          loop={loop}
          onEnded={onEnded}
          onVolumeChange={() => {}}
        >
          <VideoConfigProvider
            fps={fps}
            width={props.width ?? 1280}
            height={props.height ?? 720}
            durationInFrames={durationInFrames}
          >
            <PlayerInner {...props} ref={ref} />
          </VideoConfigProvider>
        </ClockBridgeProvider>
      </PlayerEmitterProvider>
    );
  },
);

Player.displayName = 'Player';
