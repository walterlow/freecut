import { createContext, useContext } from 'react';

export interface SequenceContextValue {
  from: number;
  durationInFrames: number;
  localFrame: number;
  parentFrom: number;
}

export const SequenceContext = createContext<SequenceContextValue | null>(null);

export function useSequenceContext(): SequenceContextValue | null {
  return useContext(SequenceContext);
}
