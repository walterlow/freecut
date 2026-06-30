/**
 * Warm-decoder cache for ProRes preview sinks.
 *
 * A {@link ProResSampleSink} owns a turbores decoder whose worker pool is expensive to
 * spawn (~100ms) and whose first decode pays container-open + first-packet cost on top.
 * The preview canvas mounts a clip's sink only when the playhead enters the clip and
 * closes it when the playhead leaves — so crossing into a ProRes clip during playback
 * cold-starts the decoder and shows black until the first frame arrives, even though a
 * paused seek onto the same clip (which has time to wait for the decode) looks fine.
 *
 * This cache keeps the sink (and its warm decoder) alive across unmounts, keyed by the
 * source URL and reference-counted. After a clip has been seeked to or played once, a
 * later crossing reuses the warm sink and paints immediately. Idle sinks are closed after
 * a cooldown, and at most {@link MAX_WARM_ENTRIES} idle sinks are retained, to bound the
 * number of live decoder worker pools.
 */

import { createLogger } from '@/shared/logging/logger'
import { createMediabunnyInputSource } from './mediabunny-input-source'
import {
  createProResSampleSink,
  detectProResTrack,
  type ProResSampleSink,
} from './prores-sample-sink'

const log = createLogger('ProResSinkCache')

/** How long a sink with no active consumers is kept warm before its decoder is closed. */
const IDLE_CLOSE_MS = 20_000
/** Maximum idle (refCount 0) sinks kept warm, to cap live turbores worker pools. */
const MAX_WARM_ENTRIES = 2

interface OpenedSink {
  sink: ProResSampleSink
  dispose: () => Promise<void>
}

interface CacheEntry {
  src: string
  refCount: number
  lastUsed: number
  idleTimer: ReturnType<typeof setTimeout> | null
  opened: Promise<OpenedSink | null>
}

const entries = new Map<string, CacheEntry>()

async function openSink(src: string): Promise<OpenedSink | null> {
  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: createMediabunnyInputSource(mb, src),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track in ProRes source')
    const info = await detectProResTrack(mb, track)
    if (!info) throw new Error('Source is not a recognized ProRes track')
    const sink = createProResSampleSink(mb, track, info)
    return {
      sink,
      dispose: async () => {
        await sink.close()
        input.dispose()
      },
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}

function closeEntry(entry: CacheEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entries.delete(entry.src)
  void entry.opened
    .then((opened) => opened?.dispose())
    .catch(() => {
      // Already failed to open; nothing to dispose.
    })
}

/** Close the least-recently-used idle entries beyond the warm cap. */
function evictExcessIdle(): void {
  const idle = [...entries.values()]
    .filter((entry) => entry.refCount === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed)
  while (idle.length > MAX_WARM_ENTRIES) {
    const victim = idle.shift()
    if (victim) closeEntry(victim)
  }
}

export interface ProResSinkLease {
  /** Resolves to the shared sink, or null if the source could not be opened. */
  sink: Promise<ProResSampleSink | null>
  /** Release this consumer's hold; the sink stays warm briefly for the next crossing. */
  release: () => void
}

/**
 * Acquire a warm ProRes sink for `src`, opening one if needed. Reference-counted: call
 * {@link ProResSinkLease.release} on unmount. The underlying decoder is kept warm for a
 * short cooldown after the last consumer releases, so re-entering the clip is instant.
 */
export function acquireProResSink(src: string): ProResSinkLease {
  let entry = entries.get(src)
  if (!entry) {
    const created: CacheEntry = {
      src,
      refCount: 0,
      lastUsed: Date.now(),
      idleTimer: null,
      opened: openSink(src).catch((error) => {
        // Drop a failed entry so a later acquire can retry the open.
        log.warn('Failed to open ProRes sink', { src, error })
        entries.delete(src)
        return null
      }),
    }
    entries.set(src, created)
    entry = created
  }

  entry.refCount++
  entry.lastUsed = Date.now()
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    const current = entries.get(src)
    if (!current || current !== entry) return
    current.refCount = Math.max(0, current.refCount - 1)
    current.lastUsed = Date.now()
    if (current.refCount === 0) {
      current.idleTimer = setTimeout(() => closeEntry(current), IDLE_CLOSE_MS)
      evictExcessIdle()
    }
  }

  return {
    sink: entry.opened.then((opened) => opened?.sink ?? null),
    release,
  }
}
