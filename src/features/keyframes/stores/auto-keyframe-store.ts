import { create } from 'zustand';
import type { AnimatableProperty } from '@/types/keyframe';

type AutoKeyframeEnabledByProperty = Partial<Record<AnimatableProperty, boolean>>;
type AutoKeyframeEnabledByItem = Record<string, AutoKeyframeEnabledByProperty>;

interface AutoKeyframeState {
  enabledByItem: AutoKeyframeEnabledByItem;
}

interface AutoKeyframeActions {
  setAutoKeyframeEnabled: (
    itemId: string,
    property: AnimatableProperty,
    enabled: boolean
  ) => void;
  toggleAutoKeyframeEnabled: (itemId: string, property: AnimatableProperty) => void;
  isAutoKeyframeEnabled: (itemId: string, property: AnimatableProperty) => boolean;
  reset: () => void;
}

function setItemPropertyEnabled(
  enabledByItem: AutoKeyframeEnabledByItem,
  itemId: string,
  property: AnimatableProperty,
  enabled: boolean
): AutoKeyframeEnabledByItem {
  const currentItemState = enabledByItem[itemId] ?? {};

  if (enabled) {
    return {
      ...enabledByItem,
      [itemId]: {
        ...currentItemState,
        [property]: true,
      },
    };
  }

  const remainingItemState = { ...currentItemState };
  delete remainingItemState[property];
  if (Object.keys(remainingItemState).length === 0) {
    const remainingItems = { ...enabledByItem };
    delete remainingItems[itemId];
    return remainingItems;
  }

  return {
    ...enabledByItem,
    [itemId]: remainingItemState,
  };
}

export const useAutoKeyframeStore = create<AutoKeyframeState & AutoKeyframeActions>()(
  (set, get) => ({
    enabledByItem: {},

    setAutoKeyframeEnabled: (itemId, property, enabled) =>
      set((state) => ({
        enabledByItem: setItemPropertyEnabled(state.enabledByItem, itemId, property, enabled),
      })),

    toggleAutoKeyframeEnabled: (itemId, property) =>
      set((state) => ({
        enabledByItem: setItemPropertyEnabled(
          state.enabledByItem,
          itemId,
          property,
          !state.enabledByItem[itemId]?.[property]
        ),
      })),

    isAutoKeyframeEnabled: (itemId, property) => Boolean(get().enabledByItem[itemId]?.[property]),

    reset: () => set({ enabledByItem: {} }),
  })
);

export function isAutoKeyframeEnabled(itemId: string, property: AnimatableProperty): boolean {
  return useAutoKeyframeStore.getState().isAutoKeyframeEnabled(itemId, property);
}

export function resetAutoKeyframeStore(): void {
  useAutoKeyframeStore.getState().reset();
}
