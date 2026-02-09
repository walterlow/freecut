import { useMemo, type FC, type ReactNode } from 'react';
import { PlayerEventEmitterContext } from './player-emitter-context';
import { PlayerEmitter } from './player-emitter';

export const PlayerEmitterProvider: FC<{
  children: ReactNode;
  emitter?: PlayerEmitter;
}> = ({ children, emitter: providedEmitter }) => {
  const emitter = useMemo(() => providedEmitter ?? new PlayerEmitter(), [providedEmitter]);

  return <PlayerEventEmitterContext.Provider value={emitter}>{children}</PlayerEventEmitterContext.Provider>;
};
