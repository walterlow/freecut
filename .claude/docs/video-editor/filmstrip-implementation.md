# Filmstrip Implementation

Quick reference for the timeline filmstrip thumbnail system.

## Architecture Overview

```
ClipFilmstrip (component)
    └── useFilmstrip (hook)
            └── filmstripCache (service)
                    ├── filmstripWorkerPool (extraction)
                    └── filmstripOPFSStorage (persistence)
```

## Key Files

| File | Purpose |
|------|---------|
| `components/clip-filmstrip/index.tsx` | Main component, renders TiledCanvas |
| `components/clip-filmstrip/tiled-canvas.tsx` | Canvas-based rendering for large clips |
| `components/clip-filmstrip/filmstrip-skeleton.tsx` | Loading placeholder (shimmer) |
| `hooks/use-filmstrip.ts` | React hook for filmstrip state |
| `services/filmstrip-cache.ts` | Memory cache + orchestration |
| `services/filmstrip-opfs-storage.ts` | Binary OPFS storage with random access |
| `services/filmstrip-worker-pool.ts` | Parallel frame extraction workers |

## Storage Format (OPFS Binary)

```
Header (32 bytes):
  - Magic: "FSTRIP" (6 bytes)
  - Version: uint8
  - Width/Height: uint16 each
  - Frame count: uint32
  - Quality: uint8
  - Reserved: 16 bytes

Index (12 bytes per frame):
  - Timestamp: float32
  - Offset: uint32
  - Size: uint32

Data:
  - Concatenated JPEG bytes
```

**Random access**: Can read any frame by seeking to index entry, then to data offset.

## Loading Flow

### Fresh Extraction (no cache)
```
1. useFilmstrip called with mediaId, blobUrl, duration
2. filmstripCache.getFilmstrip() checks:
   - Memory cache → miss
   - OPFS storage → miss
   - IndexedDB (legacy) → miss
3. Starts worker pool extraction
4. Workers extract frames at ~24fps, interleaved across workers
5. Frames arrive out-of-order, sorted by timestamp
6. Progressive updates: first frame immediate, then every 3 frames
7. On complete: persist to OPFS, update memory cache
```

### Cached Load (F5 refresh)
```
1. useFilmstrip subscribes to updates
2. filmstripCache.getFilmstrip() checks:
   - Memory cache → miss (cleared on refresh)
   - OPFS storage → HIT
3. loadFromOPFSProgressive():
   - Read entire file (single I/O)
   - Decode 20 frames in parallel (Promise.all)
   - Emit update after each batch
   - Repeat until complete
```

## Progressive Fill-in

Instead of showing a skeleton until all frames load:

1. **Skeleton**: Subtle shimmer gradient (no spinners)
2. **Immediate display**: TiledCanvas renders as soon as first frame arrives
3. **Proximity threshold**: Only render slots with a nearby frame
4. **Shimmer behind canvas**: Shows through unfilled slots

```typescript
// renderTile uses proximity threshold
const slotTimeSpan = THUMBNAIL_WIDTH / pixelsPerSecond * speed;
const proximityThreshold = slotTimeSpan * 0.6;

// Skip slots without close enough frame
if (timeDiff > proximityThreshold) continue;
```

## Performance Optimizations

### Extraction
- **2 workers** (reduced from 4 to avoid decoder contention)
- **Interleaved distribution**: Workers get alternating timestamps for faster visual fill
- **Playback-aware throttling**: Yields to video decoder during playback
- **Canvas pooling**: 3-canvas ring buffer in workers

### Loading from Cache
- **Single file read**: One I/O operation for entire file
- **Parallel JPEG decoding**: 20 frames decoded concurrently
- **Progressive updates**: UI shows frames as batches complete

### Rendering
- **Tiled canvas**: Splits large clips into 1000px tiles (avoids browser limits)
- **Quantized zoom**: Only redraws on 5px/s zoom increments
- **Binary search**: O(log n) frame lookup for slot matching
- **ImageBitmap**: GPU-accelerated, zero-copy transfer from workers

### Memory
- **LRU eviction**: 100MB memory cache limit
- **bitmap.close()**: Frees GPU memory on eviction
- **Blob persistence**: Kept for OPFS storage, not duplicated

## Constants

```typescript
THUMBNAIL_WIDTH = 78        // 16:9 aspect ratio
THUMBNAIL_HEIGHT = 44       // VIDEO_FILMSTRIP_HEIGHT
JPEG_QUALITY = 0.7          // 70% quality
MAX_CACHE_SIZE = 100MB      // Memory cache limit
FRAMES_PER_BATCH = 3        // Update frequency during extraction
DECODE_BATCH_SIZE = 20      // Parallel decoding batch
```

## Frame Matching Strategy

Uses **left edge** of thumbnail slot (not center):
- Users expect to see what's AT position X, not X + half thumbnail
- More accurate at low zoom where each thumbnail spans seconds

```typescript
const slotLeftPixel = slot * THUMBNAIL_WIDTH;
const timelineSeconds = slotLeftPixel / pixelsPerSecond;
const sourceTime = effectiveStart + timelineSeconds * speed;
// Binary search for closest frame to sourceTime
```

## Subscription Pattern

Components subscribe to filmstrip updates for progressive loading:

```typescript
// In useFilmstrip hook
useEffect(() => {
  const unsubscribe = filmstripCache.subscribe(mediaId, (updated) => {
    setFilmstrip(updated);
  });
  return unsubscribe;
}, [mediaId]);
```

## Sync Cache Check

Prevents skeleton flash when clips move between tracks:

```typescript
// Initialize from memory cache synchronously
const [filmstrip, setFilmstrip] = useState<CachedFilmstrip | null>(() => {
  return filmstripCache.getFromMemoryCacheSync(mediaId);
});
```
