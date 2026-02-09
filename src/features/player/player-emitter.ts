type SeekPayload = { frame: number };
type TimeUpdatePayload = { frame: number };
type RateChangePayload = { playbackRate: number };
type VolumeChangePayload = { volume: number; isMuted: boolean };
type FullscreenChangePayload = { isFullscreen: boolean };
type ErrorPayload = { error: Error };
type WaitingPayload = Record<string, never>;
type ResumePayload = Record<string, never>;

export type PlayerStateEventMap = {
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

export type PlayerEventTypes = keyof PlayerStateEventMap;

export type CallbackListener<T extends PlayerEventTypes> = (data: {
  detail: PlayerStateEventMap[T];
}) => void;

type PlayerListeners = {
  [EventType in PlayerEventTypes]: CallbackListener<EventType>[];
};

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

  addEventListener<Q extends PlayerEventTypes>(name: Q, callback: CallbackListener<Q>): void {
    (this.listeners[name] as CallbackListener<Q>[]).push(callback);
  }

  removeEventListener<Q extends PlayerEventTypes>(name: Q, callback: CallbackListener<Q>): void {
    this.listeners[name] = this.listeners[name].filter((l) => l !== callback) as PlayerListeners[Q];
  }

  once<Q extends PlayerEventTypes>(name: Q, callback: CallbackListener<Q>): void {
    const wrapper: CallbackListener<Q> = (data) => {
      callback(data);
      this.removeEventListener(name, wrapper);
    };
    this.addEventListener(name, wrapper);
  }

  hasListeners(name: PlayerEventTypes): boolean {
    return this.listeners[name].length > 0;
  }

  listenerCount(name: PlayerEventTypes): number {
    return this.listeners[name].length;
  }

  removeAllListeners(): void {
    Object.keys(this.listeners).forEach((key) => {
      this.listeners[key as PlayerEventTypes] = [];
    });
  }

  dispatchSeek(frame: number): void {
    this.dispatchEvent('seeked', { frame });
  }

  dispatchTimeUpdate(frame: number): void {
    this.dispatchEvent('timeupdate', { frame });
  }

  dispatchPlay(): void {
    this.dispatchEvent('play', undefined);
  }

  dispatchPause(): void {
    this.dispatchEvent('pause', undefined);
  }

  dispatchEnded(): void {
    this.dispatchEvent('ended', undefined);
  }

  dispatchRateChange(playbackRate: number): void {
    this.dispatchEvent('ratechange', { playbackRate });
  }

  dispatchVolumeChange(volume: number, isMuted: boolean): void {
    this.dispatchEvent('volumechange', { volume, isMuted });
  }

  dispatchFullscreenChange(isFullscreen: boolean): void {
    this.dispatchEvent('fullscreenchange', { isFullscreen });
  }

  dispatchError(error: Error): void {
    this.dispatchEvent('error', { error });
  }

  dispatchWaiting(): void {
    this.dispatchEvent('waiting', {});
  }

  dispatchResume(): void {
    this.dispatchEvent('resume', {});
  }

  private dispatchEvent<T extends PlayerEventTypes>(
    eventName: T,
    payload: PlayerStateEventMap[T]
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
