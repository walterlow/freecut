import { createContext, useContext } from 'react';
import type { ItemKeyframes } from '@/types/keyframe';

export interface KeyframesContextValue {
  keyframes: ItemKeyframes[];
  getItemKeyframes: (itemId: string) => ItemKeyframes | undefined;
}

export const KeyframesContext = createContext<KeyframesContextValue | null>(null);

export function useItemKeyframesFromContext(itemId: string): ItemKeyframes | undefined {
  const context = useContext(KeyframesContext);
  return context?.getItemKeyframes(itemId);
}
