const IDLE_EVICT_MS = 15000
const PREWARM_PLAY_PAUSE_MS = 48
const SEEK_TOLERANCE_SECONDS = 0.05

interface PreviewAudioPoolEntry {
  src: string
  audio: HTMLAudioElement
  inUse: boolean
  webAudioAttached: boolean
  releaseTimer: ReturnType<typeof setTimeout> | null
  warmPauseTimer: ReturnType<typeof setTimeout> | null
  warmGeneration: number
}

const entriesBySrc = new Map<string, PreviewAudioPoolEntry[]>()
const entryByAudio = new WeakMap<HTMLAudioElement, PreviewAudioPoolEntry>()

function getEntriesForSrc(src: string): PreviewAudioPoolEntry[] {
  let entries = entriesBySrc.get(src)
  if (!entries) {
    entries = []
    entriesBySrc.set(src, entries)
  }
  return entries
}

function configureAudioElement(audio: HTMLAudioElement, src: string): void {
  if (audio.src !== src) {
    audio.src = src
  }
  audio.preload = 'auto'
  audio.preservesPitch = true
  // @ts-expect-error - webkit prefix for older Safari
  audio.webkitPreservesPitch = true
}

function createEntry(src: string): PreviewAudioPoolEntry {
  const audio = new window.Audio()
  configureAudioElement(audio, src)
  const entry: PreviewAudioPoolEntry = {
    src,
    audio,
    inUse: false,
    webAudioAttached: false,
    releaseTimer: null,
    warmPauseTimer: null,
    warmGeneration: 0,
  }
  getEntriesForSrc(src).push(entry)
  entryByAudio.set(audio, entry)
  return entry
}

function detachEntry(entry: PreviewAudioPoolEntry): void {
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }
  if (entry.warmPauseTimer !== null) {
    clearTimeout(entry.warmPauseTimer)
    entry.warmPauseTimer = null
  }

  entry.warmGeneration += 1
  entry.inUse = false

  try {
    entry.audio.pause()
  } catch {
    // ignore pause errors on disposal
  }
  entry.audio.muted = false
  entry.audio.volume = 1

  try {
    entry.audio.removeAttribute('src')
    entry.audio.load()
  } catch {
    entry.audio.src = ''
  }

  const entries = entriesBySrc.get(entry.src)
  if (entries) {
    const index = entries.indexOf(entry)
    if (index >= 0) {
      entries.splice(index, 1)
    }
    if (entries.length === 0) {
      entriesBySrc.delete(entry.src)
    }
  }
}

function scheduleIdleEviction(entry: PreviewAudioPoolEntry): void {
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer)
  }
  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null
    if (!entry.inUse) {
      detachEntry(entry)
    }
  }, IDLE_EVICT_MS)
}

function cancelWarmPlayback(entry: PreviewAudioPoolEntry): void {
  entry.warmGeneration += 1
  if (entry.warmPauseTimer !== null) {
    clearTimeout(entry.warmPauseTimer)
    entry.warmPauseTimer = null
  }
  try {
    entry.audio.pause()
  } catch {
    // ignore pause errors while cancelling a warm run
  }
  entry.audio.muted = false
  entry.audio.volume = 1
}

function getReusableIdleEntry(src: string): PreviewAudioPoolEntry | null {
  const entries = entriesBySrc.get(src)
  if (!entries) {
    return null
  }
  return entries.find((entry) => !entry.inUse && !entry.webAudioAttached) ?? null
}

function warmAudioElement(entry: PreviewAudioPoolEntry, targetTimeSeconds: number): void {
  const audio = entry.audio
  const safeTargetTime = Math.max(0, targetTimeSeconds)

  cancelWarmPlayback(entry)
  const warmGeneration = entry.warmGeneration

  const startMutedWarmPlayback = () => {
    if (entry.inUse || entry.warmGeneration !== warmGeneration) {
      return
    }

    const previousMuted = audio.muted
    const previousVolume = audio.volume
    audio.muted = true
    audio.volume = 0

    const restore = () => {
      if (entry.warmGeneration !== warmGeneration) {
        return
      }
      entry.warmPauseTimer = null
      if (!entry.inUse) {
        try {
          audio.pause()
        } catch {
          // ignore pause errors after warm playback
        }
        audio.muted = previousMuted
        audio.volume = previousVolume
      }
    }

    const playPromise = audio.play()
    if (!playPromise || typeof playPromise.then !== 'function') {
      restore()
      return
    }

    playPromise
      .then(() => {
        if (entry.inUse || entry.warmGeneration !== warmGeneration) {
          try {
            audio.pause()
          } catch {
            // ignore pause errors while aborting warm playback
          }
          audio.muted = previousMuted
          audio.volume = previousVolume
          return
        }

        entry.warmPauseTimer = setTimeout(restore, PREWARM_PLAY_PAUSE_MS)
      })
      .catch(() => {
        if (entry.inUse || entry.warmGeneration !== warmGeneration) {
          return
        }
        audio.muted = previousMuted
        audio.volume = previousVolume
      })
  }

  const warmWhenReady = () => {
    if (entry.inUse || entry.warmGeneration !== warmGeneration) {
      return
    }
    if (audio.readyState >= 2) {
      startMutedWarmPlayback()
      return
    }
    audio.addEventListener(
      'canplay',
      () => {
        startMutedWarmPlayback()
      },
      { once: true },
    )
  }

  const seekAndWarm = () => {
    if (entry.inUse || entry.warmGeneration !== warmGeneration) {
      return
    }

    if (audio.readyState < 1) {
      audio.addEventListener('loadedmetadata', seekAndWarm, { once: true })
      try {
        audio.load()
      } catch {
        // ignore load errors; canplay/metadata listeners will never fire
      }
      return
    }

    if (Math.abs(audio.currentTime - safeTargetTime) <= SEEK_TOLERANCE_SECONDS) {
      warmWhenReady()
      return
    }

    const onSeeked = () => {
      warmWhenReady()
    }

    audio.addEventListener('seeked', onSeeked, { once: true })
    try {
      audio.currentTime = safeTargetTime
      if (!audio.seeking) {
        audio.removeEventListener('seeked', onSeeked)
        warmWhenReady()
      }
    } catch {
      audio.removeEventListener('seeked', onSeeked)
      warmWhenReady()
    }
  }

  seekAndWarm()
}

export function acquirePreviewAudioElement(src: string): HTMLAudioElement {
  const entry = getReusableIdleEntry(src) ?? createEntry(src)
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }
  cancelWarmPlayback(entry)
  entry.inUse = true
  configureAudioElement(entry.audio, src)
  return entry.audio
}

export function releasePreviewAudioElement(audio: HTMLAudioElement): void {
  const entry = entryByAudio.get(audio)
  if (!entry) {
    try {
      audio.pause()
    } catch {
      // ignore pause errors for unmanaged elements
    }
    return
  }

  entry.inUse = false
  cancelWarmPlayback(entry)

  if (entry.webAudioAttached) {
    detachEntry(entry)
    return
  }

  scheduleIdleEviction(entry)
}

export function markPreviewAudioElementUsesWebAudio(audio: HTMLAudioElement): void {
  const entry = entryByAudio.get(audio)
  if (!entry) {
    return
  }
  entry.webAudioAttached = true
}

export function prewarmPreviewAudioElement(src: string, targetTimeSeconds: number): void {
  if (typeof window === 'undefined') {
    return
  }

  const entry = getReusableIdleEntry(src) ?? createEntry(src)
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }
  configureAudioElement(entry.audio, src)
  warmAudioElement(entry, targetTimeSeconds)
  scheduleIdleEviction(entry)
}
