/**
 * Warm-decoder cache for ProRes preview sessions.
 *
 * A {@link ProResPreviewSession} owns a mediabunny `VideoSampleSink` whose ProRes decoder
 * (a TurboRes worker pool) is expensive to spawn (~100ms) and whose first decode pays
 * container-open + first-packet cost on top. The preview canvas mounts a clip's session
 * only when the playhead enters the clip and disposes it when the playhead leaves — so
 * crossing into a ProRes clip during playback cold-starts the decoder and shows black until
 * the first frame arrives, even though a paused seek onto the same clip (which has time to
 * wait for the decode) looks fine.
 *
 * This cache keeps the session (and its warm decoder stream) alive across unmounts, keyed
 * by the source URL and reference-counted. After a clip has been seeked to or played once,
 * a later crossing reuses the warm session and paints immediately. Idle sessions are closed
 * after a cooldown, and at most {@link MAX_WARM_ENTRIES} idle sessions are retained, to
 * bound the number of live decoder worker pools.
 *
 * Concurrent consumers of the same source (e.g. the premount prewarm and the active canvas)
 * share one session; the session serializes access internally so the shared forward-stream
 * cursor is never advanced concurrently.
 */

import { createLogger } from '@/shared/logging/logger'
import { createMediabunnyInputSource } from './mediabunny-input-source'
import {
  createProResPreviewSession,
  type ProResPreviewSession,
} from './prores-preview-session'
import { ensureProResDecoderRegistered } from './register-prores-decoder'

const log = createLogger('ProResSinkCache')

/** How long a session with no active consumers is kept warm before its decoder is closed. */
const IDLE_CLOSE_MS = 20_000
/** Maximum idle (refCount 0) sessions kept warm, to cap live decoder worker pools. */
const MAX_WARM_ENTRIES = 2

interface OpenedSession {
  session: ProResPreviewSession
  dispose: () => Promise<void>
}

interface CacheEntry {
  src: string
  refCount: number
  lastUsed: number
  idleTimer: ReturnType<typeof setTimeout> | null
  opened: Promise<OpenedSession | null>
}

const entries = new Map<string, CacheEntry>()

async function openSession(src: string): Promise<OpenedSession | null> {
  const [mb] = await Promise.all([import('mediabunny'), ensureProResDecoderRegistered()])
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: createMediabunnyInputSource(mb, src),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track in ProRes source')
    const session = createProResPreviewSession(mb, input, track)
    return {
      session,
      // The session owns and disposes the input.
      dispose: () => session.dispose(),
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

export interface ProResSessionLease {
  /** Resolves to the shared session, or null if the source could not be opened. */
  session: Promise<ProResPreviewSession | null>
  /** Release this consumer's hold; the session stays warm briefly for the next crossing. */
  release: () => void
}

/**
 * Acquire a warm ProRes preview session for `src`, opening one if needed. Reference-counted:
 * call {@link ProResSessionLease.release} on unmount. The underlying decoder is kept warm for
 * a short cooldown after the last consumer releases, so re-entering the clip is instant.
 */
export function acquireProResSession(src: string): ProResSessionLease {
  let entry = entries.get(src)
  if (!entry) {
    const created: CacheEntry = {
      src,
      refCount: 0,
      lastUsed: Date.now(),
      idleTimer: null,
      opened: openSession(src).catch((error) => {
        // Drop a failed entry so a later acquire can retry the open.
        log.warn('Failed to open ProRes session', { src, error })
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
    session: entry.opened.then((opened) => opened?.session ?? null),
    release,
  }
}
