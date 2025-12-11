import { create } from 'zustand';
import type {
  ItemKeyframes,
  AnimatableProperty,
  Keyframe,
  EasingType,
  EasingConfig,
  KeyframeRef,
} from '@/types/keyframe';

/**
 * Keyframes state - animation keyframes for timeline items.
 * Keyframes reference items by itemId - orphaned keyframes should be cleaned up
 * when items are deleted (handled by timeline-actions).
 */

export interface KeyframesState {
  keyframes: ItemKeyframes[];
}

/** Update payload for batch keyframe updates */
export interface KeyframeUpdatePayload {
  itemId: string;
  property: AnimatableProperty;
  keyframeId: string;
  updates: Partial<Omit<Keyframe, 'id'>>;
}

/** Move payload for repositioning keyframes */
export interface KeyframeMovePayload {
  ref: KeyframeRef;
  newFrame: number;
}

export interface KeyframesActions {
  // Bulk setter for snapshot restore
  setKeyframes: (keyframes: ItemKeyframes[]) => void;

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    frame: number,
    value: number,
    easing?: EasingType,
    easingConfig?: EasingConfig
  ) => string;
  _updateKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string, updates: Partial<Omit<Keyframe, 'id'>>) => void;
  _removeKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string) => void;
  _removeKeyframesForItem: (itemId: string) => void;
  _removeKeyframesForItems: (itemIds: string[]) => void;
  _removeKeyframesForProperty: (itemId: string, property: AnimatableProperty) => void;
  _scaleKeyframesForItem: (itemId: string, oldDuration: number, newDuration: number) => void;

  // Batch operations for multi-keyframe manipulation
  _updateKeyframes: (updates: KeyframeUpdatePayload[]) => void;
  _moveKeyframes: (moves: KeyframeMovePayload[]) => void;
  _removeKeyframes: (refs: KeyframeRef[]) => void;
  _duplicateKeyframes: (
    refs: KeyframeRef[],
    frameOffset: number,
    targetItemId?: string,
    targetProperty?: AnimatableProperty
  ) => string[];

  // Read-only helpers
  getKeyframesForItem: (itemId: string) => ItemKeyframes | undefined;
  getKeyframeById: (itemId: string, property: AnimatableProperty, keyframeId: string) => Keyframe | undefined;
  getAllKeyframesForProperty: (itemId: string, property: AnimatableProperty) => Keyframe[];
  hasKeyframesAtFrame: (itemId: string, property: AnimatableProperty, frame: number) => boolean;
}

export const useKeyframesStore = create<KeyframesState & KeyframesActions>()(
  (set, get) => ({
    // State
    keyframes: [],

    // Bulk setter
    setKeyframes: (keyframes) => set({ keyframes }),

    // Add keyframe
    _addKeyframe: (itemId, property, frame, value, easing = 'linear', easingConfig) => {
      const keyframeId = crypto.randomUUID();
      const newKeyframe: Keyframe = { id: keyframeId, frame, value, easing, easingConfig };

      set((state) => {
        const existingItemKeyframes = state.keyframes.find((k) => k.itemId === itemId);

        if (existingItemKeyframes) {
          // Item already has keyframes
          const existingPropKeyframes = existingItemKeyframes.properties.find(
            (p) => p.property === property
          );

          if (existingPropKeyframes) {
            // Property already has keyframes - check for existing at this frame
            const existingAtFrame = existingPropKeyframes.keyframes.find((k) => k.frame === frame);
            if (existingAtFrame) {
              // Update existing keyframe value
              return {
                keyframes: state.keyframes.map((ik) =>
                  ik.itemId === itemId
                    ? {
                        ...ik,
                        properties: ik.properties.map((pk) =>
                          pk.property === property
                            ? {
                                ...pk,
                                keyframes: pk.keyframes.map((k) =>
                                  k.frame === frame ? { ...k, value, easing, easingConfig } : k
                                ),
                              }
                            : pk
                        ),
                      }
                    : ik
                ),
              };
            }

            // Add new keyframe to existing property
            return {
              keyframes: state.keyframes.map((ik) =>
                ik.itemId === itemId
                  ? {
                      ...ik,
                      properties: ik.properties.map((pk) =>
                        pk.property === property
                          ? {
                              ...pk,
                              keyframes: [...pk.keyframes, newKeyframe]
                                .sort((a, b) => a.frame - b.frame),
                            }
                          : pk
                      ),
                    }
                  : ik
              ),
            };
          }

          // Add new property with first keyframe
          return {
            keyframes: state.keyframes.map((ik) =>
              ik.itemId === itemId
                ? {
                    ...ik,
                    properties: [
                      ...ik.properties,
                      { property, keyframes: [newKeyframe] },
                    ],
                  }
                : ik
            ),
          };
        }

        // Create new item keyframes entry
        return {
          keyframes: [
            ...state.keyframes,
            {
              itemId,
              properties: [{ property, keyframes: [newKeyframe] }],
            },
          ],
        };
      });

      return keyframeId;
    },

    // Update keyframe
    _updateKeyframe: (itemId, property, keyframeId, updates) =>
      set((state) => ({
        keyframes: state.keyframes.map((ik) =>
          ik.itemId === itemId
            ? {
                ...ik,
                properties: ik.properties.map((pk) =>
                  pk.property === property
                    ? {
                        ...pk,
                        keyframes: pk.keyframes
                          .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
                          .sort((a, b) => a.frame - b.frame),
                      }
                    : pk
                ),
              }
            : ik
        ),
      })),

    // Remove keyframe
    _removeKeyframe: (itemId, property, keyframeId) =>
      set((state) => ({
        keyframes: state.keyframes.map((ik) =>
          ik.itemId === itemId
            ? {
                ...ik,
                properties: ik.properties.map((pk) =>
                  pk.property === property
                    ? {
                        ...pk,
                        keyframes: pk.keyframes.filter((k) => k.id !== keyframeId),
                      }
                    : pk
                ),
              }
            : ik
        ),
      })),

    // Remove all keyframes for an item
    _removeKeyframesForItem: (itemId) =>
      set((state) => ({
        keyframes: state.keyframes.filter((k) => k.itemId !== itemId),
      })),

    // Remove keyframes for multiple items (cascade delete)
    _removeKeyframesForItems: (itemIds) =>
      set((state) => {
        const idsSet = new Set(itemIds);
        return {
          keyframes: state.keyframes.filter((k) => !idsSet.has(k.itemId)),
        };
      }),

    // Remove keyframes for a specific property
    _removeKeyframesForProperty: (itemId, property) =>
      set((state) => ({
        keyframes: state.keyframes.map((ik) =>
          ik.itemId === itemId
            ? {
                ...ik,
                properties: ik.properties.filter((pk) => pk.property !== property),
              }
            : ik
        ),
      })),

    // Scale keyframes when item duration changes (rate stretch)
    // Scales frame positions proportionally: newFrame = oldFrame * (newDuration / oldDuration)
    // Handles edge cases:
    // - Clamps keyframes to valid range [0, newDuration - 1]
    // - Merges colliding keyframes (keeps the one with higher original frame)
    // - Preserves keyframe at frame 0
    _scaleKeyframesForItem: (itemId, oldDuration, newDuration) => {
      // Skip if no change or invalid values
      if (oldDuration === newDuration || oldDuration <= 0 || newDuration <= 0) return;

      const scaleFactor = newDuration / oldDuration;
      const maxFrame = newDuration - 1;

      set((state) => {
        const itemKeyframes = state.keyframes.find((k) => k.itemId === itemId);
        if (!itemKeyframes) return state;

        return {
          keyframes: state.keyframes.map((ik) => {
            if (ik.itemId !== itemId) return ik;

            return {
              ...ik,
              properties: ik.properties.map((pk) => {
                if (pk.keyframes.length === 0) return pk;

                // Scale each keyframe's frame position
                const scaledKeyframes = pk.keyframes.map((kf) => ({
                  ...kf,
                  // Scale and round, but clamp to valid range
                  frame: Math.min(maxFrame, Math.max(0, Math.round(kf.frame * scaleFactor))),
                }));

                // Handle collisions: when multiple keyframes land on the same frame,
                // keep the one that was originally later (higher original frame)
                // This preserves the "destination" value of an animation
                const frameMap = new Map<number, Keyframe>();
                for (const kf of scaledKeyframes) {
                  const existing = frameMap.get(kf.frame);
                  if (!existing) {
                    frameMap.set(kf.frame, kf);
                  } else {
                    // Find original frames to determine which was later
                    const existingOriginal = pk.keyframes.find((k) => k.id === existing.id);
                    const currentOriginal = pk.keyframes.find((k) => k.id === kf.id);
                    if (existingOriginal && currentOriginal && currentOriginal.frame > existingOriginal.frame) {
                      frameMap.set(kf.frame, kf);
                    }
                  }
                }

                // Convert back to sorted array
                const deduped = Array.from(frameMap.values()).sort((a, b) => a.frame - b.frame);

                return {
                  ...pk,
                  keyframes: deduped,
                };
              }),
            };
          }),
        };
      });
    },

    // Batch update multiple keyframes at once
    _updateKeyframes: (updates) => {
      if (updates.length === 0) return;

      set((state) => {
        let newKeyframes = [...state.keyframes];

        for (const update of updates) {
          newKeyframes = newKeyframes.map((ik) =>
            ik.itemId === update.itemId
              ? {
                  ...ik,
                  properties: ik.properties.map((pk) =>
                    pk.property === update.property
                      ? {
                          ...pk,
                          keyframes: pk.keyframes
                            .map((k) =>
                              k.id === update.keyframeId ? { ...k, ...update.updates } : k
                            )
                            .sort((a, b) => a.frame - b.frame),
                        }
                      : pk
                  ),
                }
              : ik
          );
        }

        return { keyframes: newKeyframes };
      });
    },

    // Move keyframes to new frame positions
    _moveKeyframes: (moves) => {
      if (moves.length === 0) return;

      // Convert to update payloads
      const updates: KeyframeUpdatePayload[] = moves.map((move) => ({
        itemId: move.ref.itemId,
        property: move.ref.property,
        keyframeId: move.ref.keyframeId,
        updates: { frame: Math.max(0, move.newFrame) },
      }));

      get()._updateKeyframes(updates);
    },

    // Remove multiple keyframes at once
    _removeKeyframes: (refs) => {
      if (refs.length === 0) return;

      // Group refs by item and property for efficient removal
      const refsByItemAndProp = new Map<string, Set<string>>();
      for (const ref of refs) {
        const key = `${ref.itemId}:${ref.property}`;
        if (!refsByItemAndProp.has(key)) {
          refsByItemAndProp.set(key, new Set());
        }
        refsByItemAndProp.get(key)!.add(ref.keyframeId);
      }

      set((state) => ({
        keyframes: state.keyframes.map((ik) => ({
          ...ik,
          properties: ik.properties.map((pk) => {
            const key = `${ik.itemId}:${pk.property}`;
            const toRemove = refsByItemAndProp.get(key);
            if (!toRemove) return pk;

            return {
              ...pk,
              keyframes: pk.keyframes.filter((k) => !toRemove.has(k.id)),
            };
          }),
        })),
      }));
    },

    // Duplicate keyframes with frame offset
    _duplicateKeyframes: (refs, frameOffset, targetItemId, targetProperty) => {
      if (refs.length === 0) return [];

      const newIds: string[] = [];
      const state = get();

      // Gather source keyframe data
      const toDuplicate: Array<{
        property: AnimatableProperty;
        keyframe: Keyframe;
        targetItemId: string;
      }> = [];

      for (const ref of refs) {
        const itemKeyframes = state.keyframes.find((k) => k.itemId === ref.itemId);
        if (!itemKeyframes) continue;

        const propKeyframes = itemKeyframes.properties.find(
          (p) => p.property === ref.property
        );
        if (!propKeyframes) continue;

        const keyframe = propKeyframes.keyframes.find((k) => k.id === ref.keyframeId);
        if (!keyframe) continue;

        toDuplicate.push({
          property: targetProperty ?? ref.property,
          keyframe,
          targetItemId: targetItemId ?? ref.itemId,
        });
      }

      // Add duplicated keyframes
      for (const { property, keyframe, targetItemId: destItemId } of toDuplicate) {
        const newId = state._addKeyframe(
          destItemId,
          property,
          keyframe.frame + frameOffset,
          keyframe.value,
          keyframe.easing,
          keyframe.easingConfig
        );
        newIds.push(newId);
      }

      return newIds;
    },

    // Read-only: Get keyframes for an item
    getKeyframesForItem: (itemId) => {
      return get().keyframes.find((k) => k.itemId === itemId);
    },

    // Read-only: Get a specific keyframe by ID
    getKeyframeById: (itemId, property, keyframeId) => {
      const itemKeyframes = get().keyframes.find((k) => k.itemId === itemId);
      if (!itemKeyframes) return undefined;

      const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
      if (!propKeyframes) return undefined;

      return propKeyframes.keyframes.find((k) => k.id === keyframeId);
    },

    // Read-only: Get all keyframes for a property
    getAllKeyframesForProperty: (itemId, property) => {
      const itemKeyframes = get().keyframes.find((k) => k.itemId === itemId);
      if (!itemKeyframes) return [];

      const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
      if (!propKeyframes) return [];

      return propKeyframes.keyframes;
    },

    // Read-only: Check if keyframe exists at frame
    hasKeyframesAtFrame: (itemId, property, frame) => {
      const itemKeyframes = get().keyframes.find((k) => k.itemId === itemId);
      if (!itemKeyframes) return false;

      const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
      if (!propKeyframes) return false;

      return propKeyframes.keyframes.some((k) => k.frame === frame);
    },
  })
);
