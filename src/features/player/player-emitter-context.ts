import { createContext, useContext } from 'react';
import { PlayerEmitter } from './player-emitter';

export const PlayerEventEmitterContext = createContext<PlayerEmitter | undefined>(undefined);

export function usePlayerEmitter(): PlayerEmitter {
  const emitter = useContext(PlayerEventEmitterContext);
  if (!emitter) {
    throw new Error('usePlayerEmitter must be used within a player transport component');
  }
  return emitter;
}
