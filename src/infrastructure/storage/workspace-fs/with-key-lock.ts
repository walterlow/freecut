/**
 * Per-key async serialization — a lightweight mutex keyed by string.
 *
 * Read-modify-write against a workspace JSON file is otherwise a classic
 * lost-update race: two concurrent callers both read the current state,
 * each modifies, each writes back, and the second write overwrites the
 * first. File-level atomic writes protect against torn bytes, not against
 * lost updates.
 *
 * `withKeyLock(key, fn)` chains `fn` after any in-flight work on the same
 * key, so the read → mutate → write sequence is serialized within this
 * tab. Across tabs there is no protection — same-origin tabs share the
 * workspace folder but not the in-memory chain map. That's a known,
 * accepted limitation: cross-tab collisions are rare and self-heal on
 * next access (see module-level notes in content.ts / projects.ts).
 */

const chains = new Map<string, Promise<unknown>>()

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  // Silence prev's rejection for chaining purposes — we still want our own
  // work to run even if the previous caller failed. The previous caller's
  // error propagates to its own awaiter, not ours.
  const silencedPrev = prev.catch(() => {})
  const result = silencedPrev.then(fn)
  const silencedResult = result.catch(() => {})
  chains.set(key, silencedResult)
  try {
    return await result
  } finally {
    // If no-one chained after us, drop the key so the map doesn't grow
    // unbounded across a long session.
    if (chains.get(key) === silencedResult) {
      chains.delete(key)
    }
  }
}

/** Test-only: drop all chains so tests start from a clean slate. */
export function __resetKeyLocksForTesting(): void {
  chains.clear()
}
