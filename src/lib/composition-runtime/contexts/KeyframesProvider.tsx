import { useCallback, useMemo, type FC, type ReactNode } from 'react';
import type { ItemKeyframes } from '@/types/keyframe';
import { KeyframesContext } from './keyframes-context-core';

interface KeyframesProviderProps {
  keyframes: ItemKeyframes[] | undefined;
  children: ReactNode;
}

export const KeyframesProvider: FC<KeyframesProviderProps> = ({ keyframes, children }) => {
  const keyframesMap = useMemo(() => {
    const map = new Map<string, ItemKeyframes>();
    if (keyframes) {
      for (const kf of keyframes) {
        map.set(kf.itemId, kf);
      }
    }
    return map;
  }, [keyframes]);

  const getItemKeyframes = useCallback((itemId: string) => keyframesMap.get(itemId), [keyframesMap]);

  const value = useMemo(
    () => ({
      keyframes: keyframes ?? [],
      getItemKeyframes,
    }),
    [keyframes, getItemKeyframes]
  );

  if (!keyframes || keyframes.length === 0) {
    return <>{children}</>;
  }

  return <KeyframesContext.Provider value={value}>{children}</KeyframesContext.Provider>;
};
