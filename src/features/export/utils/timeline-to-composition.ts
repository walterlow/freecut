import type { TimelineTrack, TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { CompositionInputProps } from '@/types/export';
import type { ItemKeyframes, Keyframe, PropertyKeyframes } from '@/types/keyframe';
import {
  interpolatePropertyValue,
} from '@/features/export/deps/keyframes';
import { resolveEffectiveTrackStates } from '@/features/export/deps/timeline';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('TimelineToComposition');

/**
 * Convert timeline data to Composition input props
 *
 * Calculates duration from the rightmost timeline item and includes
 * resolution settings from export dialog.
 *
 * When in/out points are set, only exports the range between them:
 * - Filters items that overlap with the in/out range
 * - Adjusts item positions to be relative to in-point
 * - Sets duration to the in/out range length
 *
 * Tracks are sorted by their order property so that higher-numbered tracks
 * (e.g., Track 2) render on top of lower-numbered tracks (e.g., Track 1).
 */
export function convertTimelineToComposition(
  tracks: TimelineTrack[],
  items: TimelineItem[],
  transitions: Transition[],
  fps: number,
  width: number,
  height: number,
  inPoint?: number | null,
  outPoint?: number | null,
  keyframes?: ItemKeyframes[],
  backgroundColor?: string
): CompositionInputProps {
  // Resolve group gate behavior: parent group mute/hide propagates to children.
  // Also filters out group container tracks (which hold no items).
  tracks = resolveEffectiveTrackStates(tracks);

  // Determine if we're exporting a specific in/out range
  const hasInOutRange = inPoint !== null && inPoint !== undefined &&
                        outPoint !== null && outPoint !== undefined &&
                        outPoint > inPoint;

  // Process items based on whether in/out points are set
  let processedItems = items;
  let durationInFrames: number;
  
  // Track keyframe offsets for each item (how many frames were trimmed from start)
  const itemKeyframeOffsets = new Map<string, number>();

  if (hasInOutRange) {
    // Filter items that overlap with the in/out range
    processedItems = items
      .filter(item => {
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;
        // Keep items that overlap with [inPoint, outPoint]
        return itemEnd > inPoint! && itemStart < outPoint!;
      })
      .map(item => {
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;

        // Calculate new position relative to in-point
        const newFrom = Math.max(0, itemStart - inPoint!);

        // Calculate trimmed duration if item extends beyond in/out range
        let newDuration = item.durationInFrames;
        let additionalTrimStart = 0;
        let additionalTrimEnd = 0;

        // Trim start if item starts before in-point
        if (itemStart < inPoint!) {
          additionalTrimStart = inPoint! - itemStart;
          newDuration -= additionalTrimStart;
        }

        // Trim end if item extends beyond out-point
        if (itemEnd > outPoint!) {
          additionalTrimEnd = itemEnd - outPoint!;
          newDuration -= additionalTrimEnd;
        }

        // Store keyframe offset for this item (frames trimmed from start)
        // This is used to adjust keyframe timing when IO markers cut into a clip
        if (additionalTrimStart > 0) {
          itemKeyframeOffsets.set(item.id, additionalTrimStart);
        }

        // Create adjusted item
        const adjustedItem = {
          ...item,
          from: newFrom,
          durationInFrames: newDuration,
        };

        // Update trim properties for video/audio items
        // additionalTrimStart/End are in timeline frames, but trim/source properties are in source frames
        // Must multiply by speed to convert: timeline frames * speed = source frames
        if (item.type === 'video' || item.type === 'audio') {
          const currentTrimStart = item.trimStart || 0;
          const currentTrimEnd = item.trimEnd || 0;
          const currentSourceStart = item.sourceStart || 0;
          const speed = item.speed || 1;

          // Convert timeline frames to source frames
          const sourceTrimStart = Math.round(additionalTrimStart * speed);
          const sourceTrimEnd = Math.round(additionalTrimEnd * speed);

          const mediaItem = adjustedItem as typeof item;
          mediaItem.trimStart = currentTrimStart + sourceTrimStart;
          mediaItem.trimEnd = currentTrimEnd + sourceTrimEnd;
          mediaItem.sourceStart = currentSourceStart + sourceTrimStart;
          mediaItem.offset = mediaItem.trimStart;
        }

        // Update sourceStart for composition items (sub-comp frame offset)
        // Composition items use sourceStart to tell renderCompositionItem
        // where in the sub-comp to start playing (in timeline frames, same fps).
        if (item.type === 'composition' && additionalTrimStart > 0) {
          adjustedItem.sourceStart = (item.sourceStart || 0) + additionalTrimStart;
        }

        return adjustedItem;
      });

    // Duration is the in/out range length
    durationInFrames = outPoint! - inPoint!;
  } else {
    // No in/out range - calculate duration from the rightmost item
    const maxEndFrame = items.length > 0
      ? Math.max(...items.map(item => item.from + item.durationInFrames))
      : fps * 10; // Default to 10 seconds if no items

    // Ensure minimum duration of 1 second
    durationInFrames = Math.max(maxEndFrame, fps);
  }

  // Populate each track with its processed items
  const tracksWithItems: TimelineTrack[] = tracks.map(track => ({
    ...track,
    items: processedItems.filter(item => item.trackId === track.id),
  }));

  // Sort tracks in descending order so Track 1 (order: 0) renders last and appears on top
  // This matches the preview behavior in video-preview.tsx
  const sortedTracks = tracksWithItems.sort((a, b) => b.order - a.order);

  // Filter transitions to only include those involving clips that are in the export
  const processedItemIds = new Set(processedItems.map(item => item.id));
  const processedTransitions = transitions.filter(
    t => processedItemIds.has(t.leftClipId) && processedItemIds.has(t.rightClipId)
  );

  // Process keyframes for export
  // - Filter to only include items in the export
  // - Handle split clips (inherit from parent via originId)
  // - Apply IO marker offsets
  const processedKeyframes = processKeyframesForExport(
    keyframes ?? [],
    processedItems,
    items, // Original items for calculating split offsets
    itemKeyframeOffsets,
    processedItemIds
  );

  // Debug logging
  log.debug('Keyframes processing', {
    inputKeyframes: keyframes?.length ?? 0,
    outputKeyframes: processedKeyframes.length,
    hasIOMarkerOffsets: itemKeyframeOffsets.size > 0,
    hasSplitClips: processedItems.some(item => item.originId),
    keyframeDetails: processedKeyframes.map(kf => ({
      itemId: kf.itemId,
      properties: kf.properties.map(p => ({
        property: p.property,
        keyframeCount: p.keyframes.length,
        frames: p.keyframes.map(k => k.frame),
        values: p.keyframes.map(k => k.value),
      })),
    })),
  });

  return {
    fps,
    durationInFrames,
    width,
    height,
    tracks: sortedTracks,
    transitions: processedTransitions,
    keyframes: processedKeyframes,
    backgroundColor,
  };
}

/**
 * Process keyframes for export, handling split clips and IO markers.
 * 
 * Split clips may not have their own keyframes - they need to inherit from
 * the parent clip (identified by originId) with proper frame offset.
 * 
 * @param keyframes - All keyframes in the project
 * @param processedItems - Items being exported (may have adjusted positions)
 * @param originalItems - Original items before IO marker adjustments
 * @param ioMarkerOffsets - Frame offsets from IO marker trimming
 * @param processedItemIds - Set of item IDs in the export
 */
function processKeyframesForExport(
  keyframes: ItemKeyframes[],
  processedItems: TimelineItem[],
  originalItems: TimelineItem[],
  ioMarkerOffsets: Map<string, number>,
  processedItemIds: Set<string>
): ItemKeyframes[] {
  // Simple case: just filter keyframes for items in export
  // Only do advanced processing if needed (IO markers or split clips)
  const hasIOMarkerOffsets = ioMarkerOffsets.size > 0;
  const hasSplitClips = processedItems.some(item => item.originId);
  
  // If no special handling needed, just filter and return
  if (!hasIOMarkerOffsets && !hasSplitClips) {
    return keyframes.filter(kf => processedItemIds.has(kf.itemId));
  }

  // Build lookup map for keyframes by item ID
  const keyframesByItemId = new Map<string, ItemKeyframes>();

  for (const kf of keyframes) {
    keyframesByItemId.set(kf.itemId, kf);
  }
  
  const result: ItemKeyframes[] = [];
  
  for (const item of processedItems) {
    // Try to find keyframes for this item
    let itemKeyframes = keyframesByItemId.get(item.id);
    let splitFrameOffset = 0;
    
    // Find the original (unprocessed) version of this item for split offset calculation
    // We need the original sourceStart, not the one modified by IO marker processing
    const originalItem = originalItems.find(i => i.id === item.id);
    
    // If no direct keyframes, try to find via originId (for split clips)
    // IMPORTANT: Only inherit keyframes from the PARENT clip (where keyframes.itemId === item.originId)
    // NOT from sibling clips that happen to share the same originId
    // This prevents clip A from incorrectly inheriting clip B's keyframes when both are splits
    let isInherited = false;
    if (!itemKeyframes && item.originId) {
      // Only look up keyframes if they were defined on the ORIGINAL parent clip
      // (the clip whose id equals this item's originId)
      const parentKeyframes = keyframesByItemId.get(item.originId);
      if (parentKeyframes) {
        itemKeyframes = parentKeyframes;
        isInherited = true;

        if (originalItem) {
          // Calculate the frame offset for this split clip
          // Use the ORIGINAL item (before IO marker adjustments) to avoid double-counting
          splitFrameOffset = calculateSplitKeyframeOffset(originalItem, originalItems);
        }
      }
    }
    
    if (!itemKeyframes) continue;
    
    // If keyframes are inherited, filter out opacity keyframes
    // Opacity is a visual property that shouldn't transfer to split clips
    if (isInherited) {
      const filteredProperties = itemKeyframes.properties.filter(p => p.property !== 'opacity');
      if (filteredProperties.length === 0) continue; // No keyframes left after filtering
      itemKeyframes = { ...itemKeyframes, properties: filteredProperties };
    }
    
    // Keyframes are stored RELATIVE TO ITEM START (frame 0 = first frame of item)
    // When IO markers trim the start of an item, we need to offset the keyframes
    // because frame 0 of the export corresponds to a later frame in the original item.
    //
    // Example:
    // - Original item keyframe at frame 196 (196 frames from item start)
    // - IO marker trims 449 frames from start
    // - Export frame 0 = original frame 449
    // - Keyframe should be at frame 196 - 449 = -253 (before export, will be interpolated)
    
    // Get IO marker offset for this item
    const ioMarkerOffset = ioMarkerOffsets.get(item.id) ?? 0;
    
    // Total offset = split offset (if inheriting from parent) + IO marker offset
    const totalOffset = splitFrameOffset + ioMarkerOffset;

    // Only adjust keyframes if needed
    if (totalOffset > 0) {
      // Create adjusted keyframes for this item
      const adjustedKeyframes = adjustKeyframesForIOMarkers(
        { ...itemKeyframes, itemId: item.id }, // Use the current item's ID
        totalOffset
      );
      
      // Only add if there are actual keyframes
      if (adjustedKeyframes.properties.some((p: PropertyKeyframes) => p.keyframes.length > 0)) {
        result.push(adjustedKeyframes);
      }
    } else {
      // No adjustment needed - use original keyframes (with updated itemId if from parent)
      if (itemKeyframes.itemId !== item.id) {
        result.push({ ...itemKeyframes, itemId: item.id });
      } else {
        result.push(itemKeyframes);
      }
    }
  }
  
  return result;
}

/**
 * Calculate the keyframe frame offset for a split clip.
 * 
 * When a clip is split, the right portion starts at a different point
 * in the original animation. We need to calculate how many frames into
 * the original keyframe timeline this split starts.
 * 
 * For video items, we can use sourceStart to determine this.
 * The offset = (current sourceStart - original sourceStart) / speed
 */
function calculateSplitKeyframeOffset(
  item: TimelineItem,
  originalItems: TimelineItem[]
): number {
  // Only calculate for split clips (items with originId)
  // If no originId, this is the original clip and offset is 0
  if (!item.originId) {
    return 0;
  }
  
  if (item.type !== 'video' && item.type !== 'audio') {
    // For non-media items, we can't easily calculate the split offset
    // without additional metadata. Return 0 for now.
    return 0;
  }
  
  const currentSourceStart = item.sourceStart ?? 0;
  const speed = item.speed ?? 1;
  
  // Find the original/parent clip and sibling split clips
  // Look for items where:
  // - i.originId matches item.originId (sibling split clips)
  // - i.id matches item.originId (the original parent clip)
  const siblingItems = originalItems.filter(i => 
    i.originId === item.originId || i.id === item.originId
  );
  
  if (siblingItems.length === 0) {
    // No siblings found, shouldn't happen if originId is set correctly
    return 0;
  }
  
  // Find the minimum sourceStart among siblings - this represents the original start
  const mediaItems = siblingItems.filter(i => i.type === 'video' || i.type === 'audio');
  if (mediaItems.length === 0) {
    return 0;
  }
  
  const originalSourceStart = Math.min(
    ...mediaItems.map(i => i.sourceStart ?? 0)
  );
  
  // Calculate frame offset: how many timeline frames into the original does this start?
  // sourceStart is in source frames, so we need to convert back to timeline frames
  const sourceFrameDiff = currentSourceStart - originalSourceStart;
  const timelineFrameOffset = Math.round(sourceFrameDiff / speed);
  
  return timelineFrameOffset;
}

/**
 * Adjust keyframes when IO markers cut into a clip.
 * 
 * When an IO marker's in-point cuts into a clip:
 * 1. All keyframe frames are offset by the trim amount
 * 2. Keyframes that end up before frame 0 need special handling:
 *    - If there's an animation in progress at the new frame 0, we bake the interpolated value
 *    - Keyframes entirely before the cut are removed
 * 
 * @param itemKeyframes - Original keyframes for the item
 * @param frameOffset - Number of frames trimmed from the start (0 if no trim)
 * @returns Adjusted keyframes with proper timing
 */
function adjustKeyframesForIOMarkers(
  itemKeyframes: ItemKeyframes,
  frameOffset: number
): ItemKeyframes {
  // No offset needed - return as-is
  if (frameOffset === 0) {
    return itemKeyframes;
  }

  const adjustedProperties: PropertyKeyframes[] = itemKeyframes.properties.map(propKf => {
    const originalKeyframes = propKf.keyframes;
    
    // No keyframes for this property
    if (originalKeyframes.length === 0) {
      return propKf;
    }

    // Offset all keyframe frames
    const offsetKeyframes: Keyframe[] = originalKeyframes.map(kf => ({
      ...kf,
      frame: kf.frame - frameOffset,
    }));

    // Find keyframes that are now before frame 0 and after frame 0
    const keyframesBeforeZero = offsetKeyframes.filter(kf => kf.frame < 0);
    const keyframesAtOrAfterZero = offsetKeyframes.filter(kf => kf.frame >= 0);

    // If all keyframes are before frame 0, keep the last one at frame 0
    if (keyframesAtOrAfterZero.length === 0 && keyframesBeforeZero.length > 0) {
      const lastKeyframe = keyframesBeforeZero[keyframesBeforeZero.length - 1]!;
      return {
        ...propKf,
        keyframes: [{
          ...lastKeyframe,
          frame: 0,
        }],
      };
    }

    // If there are keyframes before zero and after zero, we need to bake the value at frame 0
    if (keyframesBeforeZero.length > 0 && keyframesAtOrAfterZero.length > 0) {
      // Check if there's already a keyframe at exactly frame 0
      const hasKeyframeAtZero = keyframesAtOrAfterZero.some(kf => kf.frame === 0);
      
      if (!hasKeyframeAtZero) {
        // Calculate the interpolated value at the new frame 0 (which was originalFrame = frameOffset)
        // We use the original keyframes with the offset frame position
        const valueAtZero = interpolatePropertyValue(
          originalKeyframes,
          frameOffset, // This is what frame 0 in the export corresponds to in the original
          originalKeyframes[0]!.value // Fallback to first keyframe value
        );

        // Find the last keyframe before zero to get its easing for the new keyframe
        const lastBeforeZero = keyframesBeforeZero[keyframesBeforeZero.length - 1]!;

        // Create a new keyframe at frame 0 with the interpolated value
        const keyframeAtZero: Keyframe = {
          id: `${lastBeforeZero.id}-interpolated-0`,
          frame: 0,
          value: valueAtZero,
          easing: lastBeforeZero.easing,
          easingConfig: lastBeforeZero.easingConfig,
        };

        // Return keyframe at 0 plus all keyframes after 0
        return {
          ...propKf,
          keyframes: [keyframeAtZero, ...keyframesAtOrAfterZero],
        };
      }
    }

    // Return only keyframes at or after frame 0
    return {
      ...propKf,
      keyframes: keyframesAtOrAfterZero,
    };
  });

  return {
    ...itemKeyframes,
    properties: adjustedProperties,
  };
}

