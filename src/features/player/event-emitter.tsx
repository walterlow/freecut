import React, { useContext, useMemo } from 'react';

/**
 * Custom Event Emitter for FreeCut Player
 * 
 * Provides a type-safe event system for player state changes,
 * inspired by Composition's PlayerEmitter but simplified for our use case.
 */

// Event payload types
type SeekPayload = { frame: number };
type TimeUpdatePayload = { frame: number };
type RateChangePayload = { playbackRate: number };
type VolumeChangePayload = { volume: number; isMuted: boolean };
type FullscreenChangePayload = { isFullscreen: boolean };
type ErrorPayload = { error: Error };
type WaitingPayload = Record<string, never>;
type ResumePayload = Record<string, never>;

// Player state event map
type PlayerStateEventMap = {
  seeked: SeekPayload;
  timeupdate: TimeUpdatePayload;
  play: undefined;
  pause: undefined;
  ended: undefined;
  ratechange: RateChangePayload;
  volumechange: VolumeChangePayload;
  fullscreenchange: FullscreenChangePayload;
  error: ErrorPayload;
  waiting: WaitingPayload;
  resume: ResumePayload;
};

// Event type exports
type PlayerEventTypes = keyof PlayerStateEventMap;

// Callback listener type
type CallbackListener<T extends PlayerEventTypes> = (data: {
  detail: PlayerStateEventMap[T];
}) => void;

// Listener storage type
type PlayerListeners = {
  [EventType in PlayerEventTypes]: CallbackListener<EventType>[];
};

/**
 * PlayerEmitter - Custom event emitter for player state
 * 
 * Features:
 * - Type-safe event listeners
 * - Automatic cleanup on remove
 * - Synchronous event dispatch
 * - Support for all player state changes
 */
export class PlayerEmitter {
  private listeners: PlayerListeners = {
    seeked: [],
    timeupdate: [],
    play: [],
    pause: [],
    ended: [],
    ratechange: [],
    volumechange: [],
    fullscreenchange: [],
    error: [],
    waiting: [],
    resume: [],
  };

  /**
   * Add an event listener
   */
  addEventListener<Q extends PlayerEventTypes>(
    name: Q,
    callback: CallbackListener<Q>,
  ): void {
    (this.listeners[name] as CallbackListener<Q>[]).push(callback);
  }

  /**
   * Remove an event listener
   */
  removeEventListener<Q extends PlayerEventTypes>(
    name: Q,
    callback: CallbackListener<Q>,
  ): void {
    this.listeners[name] = this.listeners[name].filter(
      (l) => l !== callback,
    ) as PlayerListeners[Q];
  }

  /**
   * Add one-time event listener
   */
  once<Q extends PlayerEventTypes>(
    name: Q,
    callback: CallbackListener<Q>,
  ): void {
    const wrapper: CallbackListener<Q> = (data) => {
      callback(data);
      this.removeEventListener(name, wrapper);
    };
    this.addEventListener(name, wrapper);
  }

  /**
   * Check if there are listeners for an event
   */
  hasListeners(name: PlayerEventTypes): boolean {
    return this.listeners[name].length > 0;
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(name: PlayerEventTypes): number {
    return this.listeners[name].length;
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    Object.keys(this.listeners).forEach((key) => {
      this.listeners[key as PlayerEventTypes] = [];
    });
  }

  /**
   * Dispatch a seek event
   */
  dispatchSeek(frame: number): void {
    this.dispatchEvent('seeked', { frame });
  }

  /**
   * Dispatch a time update event
   */
  dispatchTimeUpdate(frame: number): void {
    this.dispatchEvent('timeupdate', { frame });
  }

  /**
   * Dispatch a play event
   */
  dispatchPlay(): void {
    this.dispatchEvent('play', undefined);
  }

  /**
   * Dispatch a pause event
   */
  dispatchPause(): void {
    this.dispatchEvent('pause', undefined);
  }

  /**
   * Dispatch an ended event
   */
  dispatchEnded(): void {
    this.dispatchEvent('ended', undefined);
  }

  /**
   * Dispatch a rate change event
   */
  dispatchRateChange(playbackRate: number): void {
    this.dispatchEvent('ratechange', { playbackRate });
  }

  /**
   * Dispatch a volume change event
   */
  dispatchVolumeChange(volume: number, isMuted: boolean): void {
    this.dispatchEvent('volumechange', { volume, isMuted });
  }

  /**
   * Dispatch a fullscreen change event
   */
  dispatchFullscreenChange(isFullscreen: boolean): void {
    this.dispatchEvent('fullscreenchange', { isFullscreen });
  }

  /**
   * Dispatch an error event
   */
  dispatchError(error: Error): void {
    this.dispatchEvent('error', { error });
  }

  /**
   * Dispatch a waiting event (buffering)
   */
  dispatchWaiting(): void {
    this.dispatchEvent('waiting', {});
  }

  /**
   * Dispatch a resume event (buffering resolved)
   */
  dispatchResume(): void {
    this.dispatchEvent('resume', {});
  }

  /**
   * Internal method to dispatch events
   */
  private dispatchEvent<T extends PlayerEventTypes>(
    eventName: T,
    payload: PlayerStateEventMap[T],
  ): void {
    const callbacks = this.listeners[eventName] as CallbackListener<T>[];
    for (const callback of callbacks) {
      try {
        callback({ detail: payload });
      } catch (error) {
        console.error(`Error in event listener for ${eventName}:`, error);
      }
    }
  }
}

/**
 * React Context for Player Event Emitter
 */
const PlayerEventEmitterContext = React.createContext<
  PlayerEmitter | undefined
>(undefined);

/**
 * Hook to get the player emitter from context
 * @throws Error if not inside a Player component
 */
export function usePlayerEmitter(): PlayerEmitter {
  const emitter = useContext(PlayerEventEmitterContext);
  if (!emitter) {
    throw new Error('usePlayerEmitter must be used within a Player component');
  }
  return emitter;
}

/**
 * Provider component for player event emitter
 */
export const PlayerEmitterProvider: React.FC<{
  children: React.ReactNode;
  emitter?: PlayerEmitter;
}> = ({ children, emitter: providedEmitter }) => {
  const emitter = useMemo(
    () => providedEmitter ?? new PlayerEmitter(),
    [providedEmitter],
  );

  return (
    <PlayerEventEmitterContext.Provider value={emitter}>
      {children}
    </PlayerEventEmitterContext.Provider>
  );
};
