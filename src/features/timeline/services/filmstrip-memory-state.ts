import { FILMSTRIP_EXTRACT_HEIGHT, FILMSTRIP_EXTRACT_WIDTH } from '@/features/timeline/constants'
import type { FilmstripFrame } from './filmstrip-storage'

const FRAME_MEMORY_FALLBACK_BYTES = FILMSTRIP_EXTRACT_WIDTH * FILMSTRIP_EXTRACT_HEIGHT * 4

interface CacheEntryMeta {
  sizeBytes: number
  lastAccessedAt: number
}

interface FilmstripFramesState {
  frames: FilmstripFrame[]
}

interface PendingMediaLookup {
  has: (mediaId: string) => boolean
}

interface EvictionCandidatesOptions {
  hasSubscribers: (mediaId: string) => boolean
  pendingMediaIds: PendingMediaLookup
}

export class FilmstripMemoryState {
  private cacheMeta = new Map<string, CacheEntryMeta>()
  private idleEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private cacheBytes = 0

  get sizeBytes(): number {
    return this.cacheBytes
  }

  updateEntry(mediaId: string, filmstrip: FilmstripFramesState): void {
    const nextSize = this.estimateFilmstripBytes(filmstrip.frames)
    const previous = this.cacheMeta.get(mediaId)
    if (previous) {
      this.cacheBytes = Math.max(0, this.cacheBytes - previous.sizeBytes)
    }
    this.cacheBytes += nextSize
    this.cacheMeta.set(mediaId, {
      sizeBytes: nextSize,
      lastAccessedAt: Date.now(),
    })
  }

  touchEntry(mediaId: string, filmstrip: FilmstripFramesState | null): void {
    const entry = this.cacheMeta.get(mediaId)
    if (entry) {
      entry.lastAccessedAt = Date.now()
      return
    }

    if (!filmstrip) {
      return
    }

    this.updateEntry(mediaId, filmstrip)
  }

  clearEntry(mediaId: string): void {
    const previous = this.cacheMeta.get(mediaId)
    if (!previous) {
      return
    }

    this.cacheBytes = Math.max(0, this.cacheBytes - previous.sizeBytes)
    this.cacheMeta.delete(mediaId)
  }

  clearIdleTimer(mediaId: string): void {
    const timer = this.idleEvictionTimers.get(mediaId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.idleEvictionTimers.delete(mediaId)
  }

  scheduleIdleTimer(mediaId: string, idleMs: number, onEvict: () => void): void {
    this.clearIdleTimer(mediaId)

    const timer = setTimeout(() => {
      this.idleEvictionTimers.delete(mediaId)
      onEvict()
    }, idleMs)

    this.idleEvictionTimers.set(mediaId, timer)
  }

  getEvictionCandidates(options: EvictionCandidatesOptions): string[] {
    const { hasSubscribers, pendingMediaIds } = options
    return Array.from(this.cacheMeta.entries())
      .filter(([mediaId]) => !pendingMediaIds.has(mediaId))
      .sort((a, b) => {
        const aSubscribed = hasSubscribers(a[0]) ? 1 : 0
        const bSubscribed = hasSubscribers(b[0]) ? 1 : 0
        if (aSubscribed !== bSubscribed) {
          return aSubscribed - bSubscribed
        }
        return a[1].lastAccessedAt - b[1].lastAccessedAt
      })
      .map(([mediaId]) => mediaId)
  }

  clear(): void {
    for (const timer of this.idleEvictionTimers.values()) {
      clearTimeout(timer)
    }
    this.idleEvictionTimers.clear()
    this.cacheMeta.clear()
    this.cacheBytes = 0
  }

  private estimateFilmstripBytes(frames: FilmstripFrame[]): number {
    let total = 0
    for (const frame of frames) {
      total += frame.byteSize && frame.byteSize > 0 ? frame.byteSize : FRAME_MEMORY_FALLBACK_BYTES
    }
    return total
  }
}
