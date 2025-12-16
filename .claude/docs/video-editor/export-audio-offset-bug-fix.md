# Export Audio/Video Sync & Keyframe Animation Bug Fixes

## Summary

Fixed critical bugs in the client-side export system:
1. **Audio/Video desync** - Audio and video were out of sync for split clips and IO marker exports
2. **Keyframe animations missing in export** - Keyframes weren't passed to the rendering pipeline
3. **Split clip keyframe inheritance** - Split clips didn't properly inherit keyframes from parent clips
4. **IO marker keyframe offsets** - Keyframes weren't adjusted when IO markers trimmed clip starts

## Date Fixed
December 16, 2025

## Related Commits
- `938e318` - fix(export): prioritize sourceStartFrame for accurate audio offsets and fix rendering sequence
- `3365f94` - feat(export): add debug logging to client render engine
- `778385e` - feat: add keyframe support to rendering pipeline

---

## Bug #1: Audio/Video Desync

### Symptoms
1. Audio was desynchronized from video in exported files
2. Split clips had audio starting at wrong positions
3. IO marker exports (in/out point range) had misaligned audio
4. The issue was inconsistent - some exports worked, others didn't

### Root Cause

The bug was in `src/features/export/utils/canvas-audio.ts` in the `extractAudioSegments` function. When extracting audio segments for processing, the code was using the wrong priority order for determining the source start frame:

```typescript
// BEFORE (incorrect)
sourceStartFrame: videoItem.trimStart ?? videoItem.sourceStart ?? 0,
```

This prioritized `trimStart` over `sourceStart`, which is incorrect because:

1. **`trimStart`** - The user-applied trim from the beginning of the clip (how much the user manually trimmed)
2. **`sourceStart`** - The **full source offset** including:
   - Original position from split operations
   - Additional trim from IO markers
   - Base offset in the source media

When a clip is split, the right portion has a `sourceStart` that accounts for where in the source media it begins. If we use `trimStart` instead, we get the wrong offset.

### The Fix

#### 1. Audio Segment Extraction (`canvas-audio.ts`)

Changed the priority order to use `sourceStart` first:

```typescript
// AFTER (correct)
// For video items:
sourceStartFrame: videoItem.sourceStart ?? videoItem.trimStart ?? 0,

// For audio items:
sourceStartFrame: audioItem.sourceStart ?? item.trimStart ?? 0,
```

**Key insight:** `sourceStart` contains the complete offset needed to sync with video, while `trimStart` is only part of the picture.

#### 2. Video Frame Rendering (`client-render-engine.ts`)

Applied the same fix to video frame rendering to ensure video and audio use identical source offset calculations:

```typescript
// BEFORE (incorrect)
const trimStart = item.trimStart ?? item.sourceStart ?? 0;
const sourceTime = trimStart / fps + localTime * speed;

// AFTER (correct)
const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
const sourceTime = sourceStart / fps + localTime * speed;
```

#### 3. Audio Buffer Feeding Sequence

Fixed the order of operations for audio encoding. The `AudioBufferSource.add()` method must be called AFTER `output.start()`:

```typescript
// BEFORE (incorrect sequence)
output.addAudioTrack(audioSource);
audioSource.add(audioBuffer);  // Called too early!
await output.start();

// AFTER (correct sequence)
output.addAudioTrack(audioSource);
await output.start();
await audioSource.add(audioBuffer);  // After start()
audioSource.close();  // Signal end of audio data before finalize
```

---

## Bug #2: Keyframe Animations Missing in Export

### Symptoms
1. Keyframe animations worked in preview but not in exported video
2. Items appeared static in exports despite having keyframe animations
3. Server-side rendering didn't receive keyframe data

### Root Cause

Keyframes were stored in the timeline store but never passed to the Remotion composition during export. The rendering pipeline was missing:
1. Keyframe data in the `RemotionInputProps` type
2. Keyframe extraction in the export hooks
3. Keyframe context for render mode (server-side vs preview)

### The Fix

#### 1. Added Keyframes to Export Types (`src/types/export.ts`)

```typescript
export interface RemotionInputProps {
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  tracks: TimelineTrack[];
  transitions?: Transition[];
  backgroundColor?: string;
  keyframes?: ItemKeyframes[];  // NEW: Keyframe animations for items
}
```

#### 2. Extract Keyframes in Export Hook (`use-render.ts`)

```typescript
// Read current state directly from store
const state = useTimelineStore.getState();
const { tracks, items, transitions, fps, inPoint, outPoint, keyframes } = state;

// Pass keyframes to conversion function
const composition = convertTimelineToRemotion(
  tracks, items, transitions, fps,
  settings.resolution.width,
  settings.resolution.height,
  inPoint, outPoint,
  keyframes  // NEW: Pass keyframes
);
```

#### 3. Created KeyframesContext for Render Mode (`keyframes-context.tsx`)

During preview, components read keyframes from `useTimelineStore`. During render (server-side), they need to read from `inputProps`. Created a context to handle this:

```typescript
// Context provides keyframes to all composition components
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
```

#### 4. Updated Component to Use Context First (`use-item-visual-state.ts`)

```typescript
// Get keyframes for this item
// First try context (render mode with inputProps), then fall back to store (preview mode)
const contextKeyframes = useItemKeyframesFromContext(item.id);
const storeKeyframes = useTimelineStore(
  useCallback(
    (s) => s.keyframes.find((k) => k.itemId === item.id),
    [item.id]
  )
);
// Prefer context keyframes (render mode) over store keyframes (preview mode)
const itemKeyframes = contextKeyframes ?? storeKeyframes;
```

#### 5. Wrapped MainComposition with KeyframesProvider

```typescript
export const MainComposition: React.FC<RemotionInputProps> = ({ 
  tracks, transitions = [], backgroundColor = '#000000', keyframes 
}) => {
  return (
    <KeyframesProvider keyframes={keyframes}>
      <AbsoluteFill>
        {/* ... composition content ... */}
      </AbsoluteFill>
    </KeyframesProvider>
  );
};
```

---

## Bug #3: Split Clip Keyframe Inheritance

### Symptoms
1. After splitting a clip with keyframes, the right portion lost its animations
2. Keyframe timing was wrong on split clips
3. Animations jumped or skipped frames at split points

### Root Cause

When a clip is split:
1. The new clip gets a new ID but references the original via `originId`
2. Keyframes are stored by `itemId`, so the split clip has no keyframes
3. Even if we look up keyframes by `originId`, the frame numbers are relative to the original clip's start, not the split clip's start

### The Fix

Implemented keyframe inheritance with proper frame offset calculation in `timeline-to-remotion.ts`:

#### 1. Fast Path for Simple Exports

```typescript
// Simple case: just filter keyframes for items in export
// Only do advanced processing if needed (IO markers or split clips)
const hasIOMarkerOffsets = ioMarkerOffsets.size > 0;
const hasSplitClips = processedItems.some(item => item.originId);

// If no special handling needed, just filter and return
if (!hasIOMarkerOffsets && !hasSplitClips) {
  return keyframes.filter(kf => processedItemIds.has(kf.itemId));
}
```

#### 2. Build Lookup Maps for Inheritance

```typescript
const keyframesByItemId = new Map<string, ItemKeyframes>();
const keyframesByOriginId = new Map<string, ItemKeyframes>();

for (const kf of keyframes) {
  keyframesByItemId.set(kf.itemId, kf);
  // Also index by the item's originId if it has one
  const item = originalItems.find(i => i.id === kf.itemId);
  if (item?.originId) {
    if (!keyframesByOriginId.has(item.originId)) {
      keyframesByOriginId.set(item.originId, kf);
    }
  }
  // Also store by itemId as originId (for items that ARE the origin)
  keyframesByOriginId.set(kf.itemId, kf);
}
```

#### 3. Calculate Split Frame Offset

```typescript
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
  if (!item.originId) return 0;
  
  if (item.type !== 'video' && item.type !== 'audio') return 0;
  
  const currentSourceStart = item.sourceStart ?? 0;
  const speed = item.speed ?? 1;
  
  // Find siblings (items with same originId or the original itself)
  const siblingItems = originalItems.filter(i => 
    i.originId === item.originId || i.id === item.originId
  );
  
  // Find minimum sourceStart among siblings - this is the original start
  const mediaItems = siblingItems.filter(i => i.type === 'video' || i.type === 'audio');
  const originalSourceStart = Math.min(
    ...mediaItems.map(i => i.sourceStart ?? 0)
  );
  
  // Calculate frame offset accounting for speed
  const sourceFrameDiff = currentSourceStart - originalSourceStart;
  const timelineFrameOffset = Math.round(sourceFrameDiff / speed);
  
  return timelineFrameOffset;
}
```

#### 4. Example: How Split Keyframe Inheritance Works

```
Original clip (id: "clip-A"):
- sourceStart: 0
- Keyframe at frame 100: opacity = 0
- Keyframe at frame 200: opacity = 1

User splits at timeline frame 150:
- Left clip (id: "clip-A"): sourceStart = 0, keeps original keyframes
- Right clip (id: "clip-B"): sourceStart = 150, originId = "clip-A"

For right clip export:
1. No keyframes found for "clip-B"
2. Look up by originId "clip-A" -> find keyframes
3. Calculate offset: (150 - 0) / 1 = 150 frames
4. Adjust keyframes:
   - Frame 100 -> Frame -50 (before clip start, will be interpolated)
   - Frame 200 -> Frame 50
5. Bake interpolated value at frame 0:
   - Progress: 50/100 = 0.5
   - Value: 0 + (1-0) * 0.5 = 0.5
6. Final keyframes for clip-B:
   - Frame 0: opacity = 0.5 (baked)
   - Frame 50: opacity = 1
```

---

## Bug #4: IO Marker Keyframe Offsets

### Symptoms
1. When exporting with IO markers that cut into a clip, keyframe animations started at wrong times
2. Animations appeared to "jump" at the beginning of IO marker exports
3. First keyframe values were wrong

### Root Cause

IO markers can trim frames from the start of a clip. When this happens:
- Export frame 0 corresponds to a later frame in the original clip
- Keyframe frame numbers need to be offset by the trim amount
- If a keyframe animation is "in progress" at the new frame 0, we need to bake the interpolated value

### The Fix

#### 1. Track IO Marker Offsets During Processing

```typescript
// Track keyframe offsets for each item (how many frames were trimmed from start)
const itemKeyframeOffsets = new Map<string, number>();

// When processing items with IO markers...
if (itemStart < inPoint!) {
  additionalTrimStart = inPoint! - itemStart;
  // Store keyframe offset for this item
  if (additionalTrimStart > 0) {
    itemKeyframeOffsets.set(item.id, additionalTrimStart);
  }
}
```

#### 2. Adjust Keyframes for IO Marker Trim

```typescript
function adjustKeyframesForIOMarkers(
  itemKeyframes: ItemKeyframes,
  frameOffset: number
): ItemKeyframes {
  if (frameOffset === 0) return itemKeyframes;

  const adjustedProperties = itemKeyframes.properties.map(propKf => {
    const originalKeyframes = propKf.keyframes;
    if (originalKeyframes.length === 0) return propKf;

    // Offset all keyframe frames
    const offsetKeyframes = originalKeyframes.map(kf => ({
      ...kf,
      frame: kf.frame - frameOffset,
    }));

    // Find keyframes before and after frame 0
    const keyframesBeforeZero = offsetKeyframes.filter(kf => kf.frame < 0);
    const keyframesAtOrAfterZero = offsetKeyframes.filter(kf => kf.frame >= 0);

    // If all keyframes before zero, keep last one at frame 0
    if (keyframesAtOrAfterZero.length === 0 && keyframesBeforeZero.length > 0) {
      const lastKeyframe = keyframesBeforeZero[keyframesBeforeZero.length - 1]!;
      return {
        ...propKf,
        keyframes: [{ ...lastKeyframe, frame: 0 }],
      };
    }

    // If keyframes span frame 0, bake interpolated value
    if (keyframesBeforeZero.length > 0 && keyframesAtOrAfterZero.length > 0) {
      const hasKeyframeAtZero = keyframesAtOrAfterZero.some(kf => kf.frame === 0);
      
      if (!hasKeyframeAtZero) {
        // Calculate interpolated value at new frame 0
        const valueAtZero = interpolatePropertyValue(
          originalKeyframes,
          frameOffset,  // What frame 0 corresponds to in original
          originalKeyframes[0]!.value
        );

        const lastBeforeZero = keyframesBeforeZero[keyframesBeforeZero.length - 1]!;
        const keyframeAtZero = {
          id: `${lastBeforeZero.id}-interpolated-0`,
          frame: 0,
          value: valueAtZero,
          easing: lastBeforeZero.easing,
          easingConfig: lastBeforeZero.easingConfig,
        };

        return {
          ...propKf,
          keyframes: [keyframeAtZero, ...keyframesAtOrAfterZero],
        };
      }
    }

    return { ...propKf, keyframes: keyframesAtOrAfterZero };
  });

  return { ...itemKeyframes, properties: adjustedProperties };
}
```

#### 3. Example: IO Marker Keyframe Adjustment

```
Original clip:
- Keyframe at frame 100: x = 0
- Keyframe at frame 300: x = 500

IO marker in-point at frame 200 (trims 200 frames from clip start):
- frameOffset = 200

After adjustment:
- Frame 100 -> Frame -100 (before export, discard)
- Frame 300 -> Frame 100
- Need to bake value at frame 0:
  - Original frame 200 is now export frame 0
  - Interpolate between frames 100-300: progress = (200-100)/(300-100) = 0.5
  - Value at frame 0: 0 + (500-0) * 0.5 = 250

Final keyframes for export:
- Frame 0: x = 250 (baked interpolated value)
- Frame 100: x = 500
```

---

## Understanding `sourceStart` vs `trimStart`

### `trimStart`
- User-applied trim from the clip's beginning
- Only represents manual trimming by the user
- Does NOT account for split positions or IO marker adjustments

### `sourceStart`
- Complete offset in source media
- Accounts for:
  1. **Split operations**: When a clip is split, the right portion starts later in the source
  2. **IO marker trimming**: When export range cuts into a clip
  3. **Original trim**: Includes the base trim position

### Example Scenario

Original clip: 0-1000 frames in source
User splits at frame 500:
- Left clip: `sourceStart=0`, `trimStart=0`
- Right clip: `sourceStart=500`, `trimStart=0`

If we used `trimStart ?? sourceStart`:
- Right clip would seek to frame 0 instead of frame 500
- Audio/video would be 500 frames out of sync!

---

## Canvas Keyframe System (`canvas-keyframes.ts`)

The client-side render engine uses a dedicated keyframe system for canvas rendering:

```typescript
/**
 * Get the animated transform for an item at a specific frame.
 */
export function getAnimatedTransform(
  item: TimelineItem,
  keyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: CanvasRenderSettings
): ResolvedTransform {
  // Get source dimensions for proper fit-to-canvas calculation
  const sourceDimensions = getSourceDimensions(item);

  // Get base resolved transform (without animation)
  const baseResolved = resolveTransform(item, canvasSettings, sourceDimensions);

  // Calculate local frame relative to item start
  const localFrame = frame - item.from;

  // Apply keyframe animation if any
  return resolveAnimatedTransform(baseResolved, keyframes, localFrame);
}
```

**Key insight:** Keyframe frames are always **relative to item start** (local frame), not global timeline frame. This is why:
1. We calculate `localFrame = frame - item.from`
2. Split clips need offset adjustment because their "frame 0" is different from the parent's

---

## Keyframe Interpolation System

The interpolation system (`interpolation.ts`) handles smooth animation between keyframes:

```typescript
export function interpolatePropertyValue(
  keyframes: Keyframe[],
  frame: number,
  baseValue: number
): number {
  // No keyframes - use base value
  if (keyframes.length === 0) return baseValue;

  // Single keyframe - use that value for all frames
  if (keyframes.length === 1) return keyframes[0]!.value;

  // Before first keyframe - hold first value
  if (frame <= keyframes[0]!.frame) return keyframes[0]!.value;

  // After last keyframe - hold last value
  if (frame >= keyframes[keyframes.length - 1]!.frame) {
    return keyframes[keyframes.length - 1]!.value;
  }

  // Find surrounding keyframes and interpolate
  for (let i = 0; i < keyframes.length - 1; i++) {
    const prevKf = keyframes[i]!;
    const nextKf = keyframes[i + 1]!;

    if (prevKf.frame <= frame && nextKf.frame > frame) {
      return interpolateBetweenKeyframes(prevKf, nextKf, frame);
    }
  }

  return baseValue;
}
```

---

## Debug Logging Added

To help diagnose future issues, comprehensive debug logging was added:

### In `client-render-engine.ts`:
- Item counts per track at first few frames
- Video visibility checks with frame ranges
- Keyframe values at frame 0
- Canvas content presence checks
- Video draw operations with source time

### In `timeline-to-remotion.ts`:
- Original vs processed item `sourceStart` values
- IO marker ranges
- Keyframe offset calculations
- Split clip inheritance details

---

## Files Modified

1. **`src/features/export/utils/canvas-audio.ts`**
   - Fixed `sourceStartFrame` priority in `extractAudioSegments()`
   - Updated comments explaining the priority order

2. **`src/features/export/utils/client-render-engine.ts`**
   - Fixed `sourceStart` priority in `renderVideoItem()`
   - Fixed audio buffer feeding sequence (add after start)
   - Added audio source close before finalize
   - Added comprehensive debug logging
   - Integrated canvas keyframe system

3. **`src/features/export/utils/timeline-to-remotion.ts`**
   - Added `processKeyframesForExport()` function
   - Added `calculateSplitKeyframeOffset()` for split clip handling
   - Added `adjustKeyframesForIOMarkers()` for IO marker exports
   - Added fast path for simple exports
   - Added detailed debug logging

4. **`src/features/export/utils/canvas-keyframes.ts`** (new file)
   - Canvas-specific keyframe animation system
   - `getAnimatedTransform()` for frame-by-frame animation
   - `buildKeyframesMap()` for efficient lookup

5. **`src/lib/remotion/contexts/keyframes-context.tsx`** (new file)
   - Context provider for render mode keyframes
   - `useKeyframesContext()` hook
   - `useItemKeyframesFromContext()` hook

6. **`src/lib/remotion/compositions/main-composition.tsx`**
   - Wrapped with `KeyframesProvider`
   - Added `keyframes` prop handling

7. **`src/lib/remotion/components/hooks/use-item-visual-state.ts`**
   - Updated to use context keyframes first, then fall back to store

8. **`src/types/export.ts`**
   - Added `keyframes` to `RemotionInputProps`

9. **`src/features/export/hooks/use-render.ts`**
   - Extract keyframes from store
   - Pass to conversion function

10. **`server/services/render-service.ts`**
    - Pass keyframes to server-side rendering
    - Added keyframe count logging

11. **`server/types.ts`**
    - Added keyframes to `RenderRequest` type

---

## Testing Checklist

When testing export functionality, verify:

### Audio/Video Sync
- [ ] Simple clip export (no splits, no IO markers)
- [ ] Split clip export - audio syncs with video
- [ ] IO marker export - audio syncs within the range
- [ ] Split clip + IO marker combination
- [ ] Speed-changed clips maintain sync
- [ ] Multiple tracks with overlapping audio

### Keyframe Animations
- [ ] Basic keyframe animation exports correctly
- [ ] Multi-property keyframes (x, y, rotation, opacity)
- [ ] Easing functions are applied
- [ ] Keyframes at clip boundaries work correctly

### Split Clips with Keyframes
- [ ] Right split portion inherits parent keyframes
- [ ] Keyframe timing is correct relative to split point
- [ ] Animations are continuous across split point
- [ ] Multiple splits on same clip work

### IO Marker Exports with Keyframes
- [ ] Keyframes are offset correctly
- [ ] In-progress animations are baked at frame 0
- [ ] Animations continue correctly after baked start
- [ ] Combined split + IO marker scenarios

---

## Key Takeaways

1. **Always use `sourceStart` as primary** when seeking in source media
2. **`trimStart` is a fallback** for backward compatibility only
3. **Audio buffer operations have ordering requirements** - consult mediabunny docs
4. **Split clips need keyframe inheritance** via `originId` lookup with frame offset
5. **IO markers require keyframe adjustment** with interpolated values at new frame 0
6. **Keyframe frames are relative to item start** - always use local frame for interpolation
7. **Context vs Store pattern** - render mode uses context, preview uses store
8. **Add debug logging** for complex rendering pipelines
