import {
  createContext,
  useCallback,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

export interface TimelineContextValue {
  frame: number;
  playing: boolean;
  rootId: string;
  playbackRate: number;
  imperativePlaying: MutableRefObject<boolean>;
  setPlaybackRate: (rate: number) => void;
  inFrame: number | null;
  outFrame: number | null;
}

export interface SetTimelineContextValue {
  setFrame: Dispatch<SetStateAction<Record<string, number>>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
}

export const BridgedTimelineContext = createContext<TimelineContextValue | null>(null);
export const BridgedSetTimelineContext = createContext<SetTimelineContextValue | null>(null);

export function useBridgedTimelineContext(): TimelineContextValue {
  const context = useContext(BridgedTimelineContext);
  if (!context) {
    throw new Error('useBridgedTimelineContext must be used within a ClockBridgeProvider');
  }
  return context;
}

export function useBridgedSetTimelineContext(): SetTimelineContextValue {
  const context = useContext(BridgedSetTimelineContext);
  if (!context) {
    throw new Error('useBridgedSetTimelineContext must be used within a ClockBridgeProvider');
  }
  return context;
}

export function useBridgedCurrentFrame(): number {
  return useBridgedTimelineContext().frame;
}

export function useBridgedIsPlaying(): boolean {
  return useBridgedTimelineContext().playing;
}

export function useBridgedSetTimelineFrame(): (frame: number) => void {
  const { setFrame } = useBridgedSetTimelineContext();
  const { inFrame, outFrame } = useBridgedTimelineContext();

  return useCallback(
    (newFrame: number) => {
      let clampedFrame = newFrame;
      if (inFrame !== null && clampedFrame < inFrame) {
        clampedFrame = inFrame;
      }
      if (outFrame !== null && clampedFrame > outFrame) {
        clampedFrame = outFrame;
      }

      setFrame((c) => ({
        ...c,
        'player-comp': clampedFrame,
      }));
    },
    [setFrame, inFrame, outFrame]
  );
}

export function useBridgedActualFirstFrame(): number {
  const { inFrame } = useBridgedTimelineContext();
  return inFrame ?? 0;
}

export function useBridgedActualLastFrame(durationInFrames: number): number {
  const { outFrame } = useBridgedTimelineContext();
  return outFrame ?? durationInFrames - 1;
}
