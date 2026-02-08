import React, { createContext, useContext, useMemo, useCallback } from 'react';
import type { ItemKeyframes } from '@/types/keyframe';

/**
 * Context for providing keyframes to Composition composition components.
 *
 * During preview (Player), keyframes are read from the timeline store via useTimelineStore.
 * During render (server-side), keyframes are passed as inputProps and provided via this context.
 *
 * Components should use `useItemKeyframesFromContext` to get keyframes, which will:
 * - Return keyframes from context if available (render mode)
 * - Return undefined if no context (preview mode - component should fall back to store)
 */

interface KeyframesContextValue {
  /** All keyframes passed from input props */
  keyframes: ItemKeyframes[];
  /** Get keyframes for a specific item by ID */
  getItemKeyframes: (itemId: string) => ItemKeyframes | undefined;
}

const KeyframesContext = createContext<KeyframesContextValue | null>(null);

interface KeyframesProviderProps {
  keyframes: ItemKeyframes[] | undefined;
  children: React.ReactNode;
}

/**
 * Provider component that makes keyframes available to all child components.
 * Use this at the root of the Composition composition when keyframes are provided via inputProps.
 */
export const KeyframesProvider: React.FC<KeyframesProviderProps> = ({ keyframes, children }) => {
  // Build a map for O(1) lookup by itemId
  const keyframesMap = useMemo(() => {
    const map = new Map<string, ItemKeyframes>();
    if (keyframes) {
      for (const kf of keyframes) {
        map.set(kf.itemId, kf);
      }
    }
    return map;
  }, [keyframes]);

  const getItemKeyframes = useCallback(
    (itemId: string) => keyframesMap.get(itemId),
    [keyframesMap]
  );

  const value = useMemo(
    () => ({
      keyframes: keyframes ?? [],
      getItemKeyframes,
    }),
    [keyframes, getItemKeyframes]
  );

  // Only provide context if keyframes are actually passed
  // This allows components to detect render vs preview mode
  if (!keyframes || keyframes.length === 0) {
    return <>{children}</>;
  }

  return (
    <KeyframesContext.Provider value={value}>
      {children}
    </KeyframesContext.Provider>
  );
};

/**
 * Hook to get keyframes for a specific item.
 * First checks context (render mode), then returns undefined (component should fall back to store).
 *
 * @param itemId - The item ID to get keyframes for
 * @returns ItemKeyframes if found in context, undefined otherwise
 */
export function useItemKeyframesFromContext(itemId: string): ItemKeyframes | undefined {
  const context = useContext(KeyframesContext);
  return context?.getItemKeyframes(itemId);
}
