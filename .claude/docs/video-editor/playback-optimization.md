# Playback Optimization Guide

This document covers performance optimizations for smooth audio/video playback, specifically addressing React re-render issues that cause `@remotion/media` Audio to stutter.

## Problem Context

The `@remotion/media` Audio component is sensitive to main thread jank. React re-renders during playback can cause audio stuttering, even when the re-renders seem minor. Video (using `OffthreadVideo`) is more resilient since it runs in a separate thread.

## Root Cause

During playback, `currentFrame` updates at 30fps (or project fps). Any component subscribing to `currentFrame` via Zustand re-renders on every frame update. If multiple components subscribe, this creates a cascade of re-renders that blocks the main thread and causes audio to stutter.

## Optimization Patterns

### 1. Throttle Frame Updates During Playback

In `use-remotion-player.ts`, frame updates are throttled to ~12fps (80ms) during active playback. This provides smooth timecode/playhead updates while reducing main thread work.

```typescript
// use-remotion-player.ts
const THROTTLE_MS = 80; // ~12fps during playback

const handleFrameUpdate = (e: { detail: { frame: number } }) => {
  const isPlaying = usePlaybackStore.getState().isPlaying;

  if (isPlaying) {
    // Throttle during playback
    const now = performance.now();
    if (now - lastUpdateTime >= THROTTLE_MS) {
      lastUpdateTime = now;
      setCurrentFrame(newFrame);
    }
  } else {
    // Immediate updates when paused/scrubbing
    setCurrentFrame(newFrame);
  }
};
```

### 2. Avoid `currentFrame` Subscriptions

Most components don't need to re-render on every frame. Instead of subscribing:

```typescript
// BAD - causes re-render every frame
const currentFrame = usePlaybackStore((s) => s.currentFrame);

const handleClick = () => {
  doSomething(currentFrame);
};
```

Read from store directly in callbacks:

```typescript
// GOOD - no subscription, no re-renders
const handleClick = () => {
  const currentFrame = usePlaybackStore.getState().currentFrame;
  doSomething(currentFrame);
};
```

### 3. Use Ref Pattern for Store Values

When you need to track a value without re-renders:

```typescript
// Subscribe via ref - no component re-renders
const currentFrameRef = useRef(usePlaybackStore.getState().currentFrame);

useEffect(() => {
  return usePlaybackStore.subscribe((state) => {
    currentFrameRef.current = state.currentFrame;
  });
}, []);

// Use currentFrameRef.current in callbacks
```

### 4. Remove from useMemo Dependencies

Don't include `currentFrame` in useMemo dependencies if the computation doesn't actually need it on every frame:

```typescript
// BAD - recalculates every frame
const snapTargets = useMemo(() => {
  return [...targets, { frame: currentFrame, type: 'playhead' }];
}, [targets, currentFrame]); // currentFrame causes recalc every frame

// GOOD - add playhead dynamically when needed
const snapTargets = useMemo(() => targets, [targets]);

const calculateSnap = () => {
  const currentFrame = usePlaybackStore.getState().currentFrame;
  const allTargets = [...snapTargets, { frame: currentFrame, type: 'playhead' }];
  // ...
};
```

## Components That MUST Subscribe to `currentFrame`

These components need to update visually during playback:

| Component | File | Reason |
|-----------|------|--------|
| `TimecodeDisplay` | `preview/components/timecode-display.tsx` | Shows current time |
| `TimelinePlayhead` | `timeline/components/timeline-playhead.tsx` | Visual playhead position |

These are acceptable because:
1. Frame updates are already throttled to 150ms during playback
2. They're leaf components with minimal render cost

## Components That Should NOT Subscribe

| Component | Pattern Used |
|-----------|--------------|
| `TimelineContent` | Ref pattern for currentFrame |
| `TimelineHeader` | Read from store in click handlers |
| `PlaybackControls` | Read from store in handlers |
| `useTimelineShortcuts` | Read from store in hotkey callbacks |
| `useSnapCalculator` | Dynamic addition in calculateSnap |

## Other Optimizations Applied

### Canvas-Based Timeline Markers

The TimelineMarkers component uses Canvas rendering instead of DOM elements to eliminate React reconciliation overhead during zoom:

```typescript
// timeline-markers.tsx - Canvas drawing instead of Array.map
useEffect(() => {
  const ctx = canvas.getContext('2d');
  // Draw tick lines and labels directly on canvas
  for (let i = startMarkerIndex; i <= endMarkerIndex; i++) {
    const x = timeToPixels(i * intervalInSeconds);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
    // Draw label...
  }
}, [displayWidth, pixelsPerSecond, scrollLeft, viewportWidth]);
```

Benefits:
- ~1-2ms canvas redraw vs ~200ms DOM reconciliation
- No React diffing overhead
- Smooth zoom even during audio playback
- In/Out markers and Project markers remain as DOM (minimal elements)

### Context Provider Placement

`TooltipProvider` was moved from `Editor` to `App` level to prevent re-render cascades:

```typescript
// App.tsx - TooltipProvider at top level
<TooltipProvider delayDuration={300}>
  <RouterProvider router={router} />
</TooltipProvider>
```

### RAF Loop Control

The Timeline component's RAF loop only runs during track dragging, not continuously:

```typescript
// timeline.tsx
useEffect(() => {
  if (!isTrackDragging) {
    setDropIndicatorIndex(-1);
    return; // No RAF when not dragging
  }
  // ... RAF loop only during drag
}, [isTrackDragging]);
```

### Memoization

Key timeline components are memoized:
- `TimelineItem` - `memo()`
- `TimelineTrack` - `memo()`
- `TimelineMarkers` - `memo()`

## Adding New Features - Checklist

When adding features that interact with playback state:

1. **Don't subscribe to `currentFrame`** unless the component must visually update every frame
2. **Read from store directly** in event handlers: `usePlaybackStore.getState().currentFrame`
3. **Use ref pattern** if you need to track the value without re-renders
4. **Keep `currentFrame` out of useMemo/useCallback deps** unless absolutely necessary
5. **Test with audio playback** - if audio stutters, profile for re-render cascades
6. **Check the profiler** - look for components in "What caused this update?" during playback

## Debugging Playback Issues

1. **React DevTools Profiler**: Record during playback, look for:
   - Components re-rendering frequently
   - Long render times (>16ms for 60fps)
   - "What caused this update?" showing unexpected components

2. **Console Logging**: Temporarily add logs to suspect components:
   ```typescript
   console.log('[ComponentName] render');
   ```

3. **Throttle Testing**: Temporarily increase `THROTTLE_MS` in `use-remotion-player.ts` to isolate if frame updates are the cause

## Related Files

- `src/features/preview/hooks/use-remotion-player.ts` - Frame sync and throttling
- `src/features/preview/stores/playback-store.ts` - Playback state
- `src/lib/remotion/components/item.tsx` - Remotion media rendering
- `src/lib/remotion/compositions/main-composition.tsx` - Composition structure
