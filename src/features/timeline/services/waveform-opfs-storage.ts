/**
 * OPFS Waveform Storage
 *
 * Multi-resolution binary format for efficient waveform storage with random access:
 *
 * Header (48 bytes):
 *   - Magic: "WFORM" (5 bytes)
 *   - Version: uint8 (1 byte)
 *   - Duration: float32 (4 bytes)
 *   - Channels: uint8 (1 byte)
 *   - Level count: uint8 (1 byte)
 *   - Reserved: (36 bytes)
 *
 * Level Index (12 bytes per level):
 *   - Sample rate: uint16 (2 bytes)
 *   - Sample count: uint32 (4 bytes)
 *   - Data offset: uint32 (4 bytes)
 *   - Reserved: (2 bytes)
 *
 * Data:
 *   - Float32 peak values for each level, concatenated
 *
 * Resolution levels (for efficient zoom rendering):
 *   - Level 0: 500 samples/sec (highest detail, zoomed in)
 *   - Level 1: 100 samples/sec (medium detail)
 *   - Level 2: 25 samples/sec (low detail, zoomed out)
 *   - Level 3: 10 samples/sec (overview)
 */

import { createLogger } from '@/shared/logging/logger'
import { getCacheMigration } from '@/infrastructure/storage/cache-version'
import {
  mirrorBytesToWorkspace,
  readWorkspaceBlob,
  removeWorkspaceCacheEntry,
} from '@/infrastructure/storage/workspace-fs/cache-mirror'
import { waveformMultiResPath } from '@/infrastructure/storage/workspace-fs/paths'

const logger = createLogger('WaveformOPFS')

const MAGIC = 'WFORM'
const RANGE_MAGIC = 'WFRNG'
const BINARY_VERSION = 1 // Version stored in file header (for parsing)
const HEADER_SIZE = 48
const RANGE_HEADER_SIZE = 64
const LEVEL_INDEX_SIZE = 12
const WAVEFORM_DIR = 'waveforms'

// Multi-resolution levels (samples per second)
export const WAVEFORM_LEVELS = [500, 100, 25, 10] as const

function getFloatsPerSample(channels: number): number {
  return channels >= 2 ? 2 : 1
}

interface WaveformHeader {
  duration: number
  channels: number
  levelCount: number
}

interface LevelIndex {
  sampleRate: number
  sampleCount: number
  offset: number
}

interface RangeIndex {
  mediaId: string
  fileName: string
  sampleRate: number
  startSample: number
  sampleCount: number
}

export interface MultiResolutionWaveform {
  duration: number
  channels: number
  levels: {
    sampleRate: number
    peaks: Float32Array
  }[]
}

export interface WaveformRange {
  duration: number
  channels: number
  sampleRate: number
  startSample: number
  peaks: Float32Array
}

/**
 * Choose a resolution level for range-based reads where bars are a few pixels
 * wide (used by getWaveformRange/getWaveformLevel).
 */
export function chooseLevelForZoom(pixelsPerSecond: number): number {
  // Bars are typically 2-3 pixels wide, so we want ~1 sample per 3 pixels
  const desiredSamplesPerSecond = pixelsPerSecond / 3

  for (let i = 0; i < WAVEFORM_LEVELS.length; i++) {
    if (WAVEFORM_LEVELS[i]! <= desiredSamplesPerSecond * 2) {
      return i
    }
  }
  return WAVEFORM_LEVELS.length - 1
}

// At or above this zoom we render full resolution (level 0). Any downsampled
// level visibly loses transient detail when scrutinizing a waveform, so we only
// drop below full-res at overview zoom, where the whole (often long) clip is on
// screen — there the detail is imperceptible but the memory savings are largest
// (16 px/s ≈ a full minute of audio across a ~960px viewport).
const DISPLAY_FULL_RES_MIN_PIXELS_PER_SECOND = 16

/**
 * Choose the resolution level for rendering a full clip's waveform at a given
 * zoom. Returns full resolution (level 0) whenever zoomed in enough to inspect
 * detail; only at overview zoom does it step down to the coarsest level that
 * still keeps comfortably more than one sample per pixel (so it stays smooth
 * while using a fraction of the memory for a long clip).
 */
export function chooseDisplayLevelForZoom(pixelsPerSecond: number): number {
  if (pixelsPerSecond >= DISPLAY_FULL_RES_MIN_PIXELS_PER_SECOND) {
    return 0
  }

  const neededSamplesPerSecond = Math.max(1, pixelsPerSecond * 1.5)
  // WAVEFORM_LEVELS is descending; walk from coarsest to finest and take the
  // first (coarsest) level that still meets the needed density.
  for (let i = WAVEFORM_LEVELS.length - 1; i >= 0; i--) {
    if (WAVEFORM_LEVELS[i]! >= neededSamplesPerSecond) {
      return i
    }
  }
  return 0
}

/**
 * OPFS Waveform Storage Service
 * Provides efficient multi-resolution binary storage with range-based access
 */
class WaveformOPFSStorage {
  private rootHandle: FileSystemDirectoryHandle | null = null
  private dirHandle: FileSystemDirectoryHandle | null = null
  private initPromise: Promise<FileSystemDirectoryHandle> | null = null

  /**
   * Initialize OPFS directory (with migration)
   */
  private async ensureDirectory(): Promise<FileSystemDirectoryHandle> {
    // Return cached handle if ready
    if (this.dirHandle) return this.dirHandle

    // Ensure only one initialization runs
    if (this.initPromise) return this.initPromise

    this.initPromise = this.initializeWithMigration()
    return this.initPromise
  }

  /**
   * Initialize directory and run migration if needed
   */
  private async initializeWithMigration(): Promise<FileSystemDirectoryHandle> {
    try {
      this.rootHandle = await navigator.storage.getDirectory()
      const dir = await this.rootHandle.getDirectoryHandle(WAVEFORM_DIR, {
        create: true,
      })

      // Run migration BEFORE setting dirHandle (blocks all access until complete)
      const migration = getCacheMigration('waveform')
      if (migration.needsMigration) {
        const entries: string[] = []
        for await (const entry of dir.values()) {
          if (entry.kind === 'file') {
            entries.push(entry.name)
          }
        }

        for (const name of entries) {
          await dir.removeEntry(name).catch(() => {})
        }

        migration.markComplete()
        logger.info(
          `Waveform cache version updated: v${migration.oldVersion ?? 'none'} â†’ v${migration.newVersion}${entries.length > 0 ? ` (cleared ${entries.length} files)` : ''}`,
        )
      }

      this.dirHandle = dir
      return dir
    } catch (error) {
      logger.error('Failed to initialize OPFS waveform directory:', error)
      throw error
    }
  }

  /**
   * Write header to buffer
   */
  private writeHeader(view: DataView, header: WaveformHeader): void {
    let offset = 0

    // Magic bytes
    for (let i = 0; i < MAGIC.length; i++) {
      view.setUint8(offset++, MAGIC.charCodeAt(i))
    }

    // Version
    view.setUint8(offset++, BINARY_VERSION)

    // Duration (float32)
    view.setFloat32(offset, header.duration, true)
    offset += 4

    // Channels
    view.setUint8(offset++, header.channels)

    // Level count
    view.setUint8(offset++, header.levelCount)

    // Reserved bytes (remaining up to HEADER_SIZE)
  }

  /**
   * Read header from buffer
   */
  private readHeader(view: DataView): WaveformHeader | null {
    let offset = 0

    // Verify magic
    let magic = ''
    for (let i = 0; i < MAGIC.length; i++) {
      magic += String.fromCharCode(view.getUint8(offset++))
    }
    if (magic !== MAGIC) {
      logger.warn('Invalid waveform magic bytes')
      return null
    }

    // Check version
    const version = view.getUint8(offset++)
    if (version !== BINARY_VERSION) {
      // Old version - will be auto-cleared by migration
      return null
    }

    // Duration
    const duration = view.getFloat32(offset, true)
    offset += 4

    // Channels
    const channels = view.getUint8(offset++)

    // Level count
    const levelCount = view.getUint8(offset)

    return { duration, channels, levelCount }
  }

  /**
   * Write level index entry
   */
  private writeLevelIndex(view: DataView, index: number, entry: LevelIndex): void {
    const offset = HEADER_SIZE + index * LEVEL_INDEX_SIZE
    view.setUint16(offset, entry.sampleRate, true)
    view.setUint32(offset + 2, entry.sampleCount, true)
    view.setUint32(offset + 6, entry.offset, true)
    // 2 bytes reserved
  }

  /**
   * Read level index entry
   */
  private readLevelIndex(view: DataView, index: number): LevelIndex {
    const offset = HEADER_SIZE + index * LEVEL_INDEX_SIZE
    return {
      sampleRate: view.getUint16(offset, true),
      sampleCount: view.getUint32(offset + 2, true),
      offset: view.getUint32(offset + 6, true),
    }
  }

  private getRangeFileName(
    mediaId: string,
    sampleRate: number,
    startSample: number,
    sampleCount: number,
  ): string {
    return `${mediaId}.range.${sampleRate}.${startSample}.${sampleCount}.bin`
  }

  private parseRangeFileName(fileName: string): RangeIndex | null {
    const match = /^(.+)\.range\.(\d+)\.(\d+)\.(\d+)\.bin$/.exec(fileName)
    if (!match) return null

    const [, mediaId, sampleRateValue, startSampleValue, sampleCountValue] = match
    const sampleRate = Number(sampleRateValue)
    const startSample = Number(startSampleValue)
    const sampleCount = Number(sampleCountValue)
    if (
      !mediaId ||
      !Number.isFinite(sampleRate) ||
      !Number.isFinite(startSample) ||
      !Number.isFinite(sampleCount) ||
      sampleRate <= 0 ||
      startSample < 0 ||
      sampleCount <= 0
    ) {
      return null
    }

    return { mediaId, fileName, sampleRate, startSample, sampleCount }
  }

  private writeRangeHeader(
    view: DataView,
    range: {
      duration: number
      channels: number
      sampleRate: number
      startSample: number
      sampleCount: number
    },
  ): void {
    let offset = 0
    for (let i = 0; i < RANGE_MAGIC.length; i++) {
      view.setUint8(offset++, RANGE_MAGIC.charCodeAt(i))
    }
    view.setUint8(offset++, BINARY_VERSION)
    view.setFloat32(offset, range.duration, true)
    offset += 4
    view.setUint8(offset++, range.channels)
    view.setUint16(offset, range.sampleRate, true)
    offset += 2
    view.setUint32(offset, range.startSample, true)
    offset += 4
    view.setUint32(offset, range.sampleCount, true)
  }

  private readRangeHeader(view: DataView): {
    duration: number
    channels: number
    sampleRate: number
    startSample: number
    sampleCount: number
  } | null {
    let offset = 0
    let magic = ''
    for (let i = 0; i < RANGE_MAGIC.length; i++) {
      magic += String.fromCharCode(view.getUint8(offset++))
    }
    if (magic !== RANGE_MAGIC) return null

    const version = view.getUint8(offset++)
    if (version !== BINARY_VERSION) return null

    const duration = view.getFloat32(offset, true)
    offset += 4
    const channels = view.getUint8(offset++)
    const sampleRate = view.getUint16(offset, true)
    offset += 2
    const startSample = view.getUint32(offset, true)
    offset += 4
    const sampleCount = view.getUint32(offset, true)

    return { duration, channels, sampleRate, startSample, sampleCount }
  }

  /**
   * Generate multi-resolution peaks from source peaks
   */
  generateMultiResolution(
    sourcePeaks: Float32Array,
    sourceSampleRate: number,
    duration: number,
    channels: number = 1,
  ): { sampleRate: number; peaks: Float32Array }[] {
    const stereo = channels >= 2
    const levels: { sampleRate: number; peaks: Float32Array }[] = []

    for (const targetRate of WAVEFORM_LEVELS) {
      if (targetRate >= sourceSampleRate) {
        // Can't upsample. Keep a source-rate entry for this slot so partially
        // prepared overview files still satisfy every display-level index.
        levels.push({ sampleRate: sourceSampleRate, peaks: sourcePeaks })
        continue
      }

      // Downsample from source
      const numSamples = Math.ceil(duration * targetRate)
      const ratio = sourceSampleRate / targetRate

      if (stereo) {
        // Interleaved L/R: downsample each channel independently
        const downsampled = new Float32Array(numSamples * 2)
        const sourcePerChannel = sourcePeaks.length / 2

        for (let i = 0; i < numSamples; i++) {
          const startIdx = Math.floor(i * ratio)
          const endIdx = Math.min(Math.floor((i + 1) * ratio), sourcePerChannel)

          let maxL = 0
          let maxR = 0
          for (let j = startIdx; j < endIdx; j++) {
            const lVal = sourcePeaks[j * 2] ?? 0
            const rVal = sourcePeaks[j * 2 + 1] ?? 0
            if (lVal > maxL) maxL = lVal
            if (rVal > maxR) maxR = rVal
          }
          downsampled[i * 2] = maxL
          downsampled[i * 2 + 1] = maxR
        }

        levels.push({ sampleRate: targetRate, peaks: downsampled })
      } else {
        // Mono: original behavior
        const downsampled = new Float32Array(numSamples)

        for (let i = 0; i < numSamples; i++) {
          const startIdx = Math.floor(i * ratio)
          const endIdx = Math.min(Math.floor((i + 1) * ratio), sourcePeaks.length)

          let maxPeak = 0
          for (let j = startIdx; j < endIdx; j++) {
            const val = sourcePeaks[j] ?? 0
            if (val > maxPeak) maxPeak = val
          }
          downsampled[i] = maxPeak
        }

        levels.push({ sampleRate: targetRate, peaks: downsampled })
      }
    }

    return levels
  }

  /**
   * Save waveform to OPFS with multi-resolution levels
   */
  async save(mediaId: string, waveform: MultiResolutionWaveform): Promise<void> {
    const dir = await this.ensureDirectory()
    const fileName = `${mediaId}.bin`

    try {
      const levelCount = waveform.levels.length
      const indexSize = levelCount * LEVEL_INDEX_SIZE
      const headerAndIndexSize = HEADER_SIZE + indexSize

      // Calculate total data size
      let totalDataSize = 0
      for (const level of waveform.levels) {
        totalDataSize += level.peaks.byteLength
      }

      // Create buffer
      const totalSize = headerAndIndexSize + totalDataSize
      const buffer = new ArrayBuffer(totalSize)
      const view = new DataView(buffer)
      const uint8 = new Uint8Array(buffer)

      // Write header
      this.writeHeader(view, {
        duration: waveform.duration,
        channels: waveform.channels,
        levelCount,
      })

      // Write index and data
      let dataOffset = headerAndIndexSize
      for (let i = 0; i < levelCount; i++) {
        const level = waveform.levels[i]!
        const floatsPerSample = getFloatsPerSample(waveform.channels)

        // Write index entry
        this.writeLevelIndex(view, i, {
          sampleRate: level.sampleRate,
          sampleCount: level.peaks.length / floatsPerSample,
          offset: dataOffset,
        })

        // Write level data
        uint8.set(new Uint8Array(level.peaks.buffer), dataOffset)
        dataOffset += level.peaks.byteLength
      }

      // Write to OPFS
      const fileHandle = await dir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(buffer)
      await writable.close()

      // Mirror the binary to the workspace folder so other origins can reuse
      // the multi-resolution waveform without regenerating. Fire-and-forget.
      void mirrorBytesToWorkspace(waveformMultiResPath(mediaId), buffer)

      logger.debug(
        `Saved waveform ${mediaId}: ${levelCount} levels, ${(totalSize / 1024).toFixed(1)}KB`,
      )
    } catch (error) {
      logger.error(`Failed to save waveform ${mediaId}:`, error)
      throw error
    }
  }

  async saveRange(
    mediaId: string,
    range: {
      duration: number
      channels: number
      sampleRate: number
      startTime: number
      endTime: number
      peaks: Float32Array
    },
  ): Promise<void> {
    if (range.sampleRate <= 0 || range.endTime <= range.startTime || range.peaks.length === 0) {
      return
    }

    const dir = await this.ensureDirectory()
    const floatsPerSample = getFloatsPerSample(range.channels)
    const totalSamples = Math.floor(range.peaks.length / floatsPerSample)
    const startSample = Math.max(0, Math.floor(range.startTime * range.sampleRate))
    const endSample = Math.min(totalSamples, Math.ceil(range.endTime * range.sampleRate))
    const sampleCount = Math.max(0, endSample - startSample)
    if (sampleCount <= 0) return

    const valueStart = startSample * floatsPerSample
    const valueEnd = endSample * floatsPerSample
    const compactPeaks = range.peaks.slice(valueStart, valueEnd)
    const totalSize = RANGE_HEADER_SIZE + compactPeaks.byteLength
    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const uint8 = new Uint8Array(buffer)

    this.writeRangeHeader(view, {
      duration: range.duration,
      channels: range.channels,
      sampleRate: range.sampleRate,
      startSample,
      sampleCount,
    })
    uint8.set(new Uint8Array(compactPeaks.buffer), RANGE_HEADER_SIZE)

    const fileHandle = await dir.getFileHandle(
      this.getRangeFileName(mediaId, range.sampleRate, startSample, sampleCount),
      { create: true },
    )
    const writable = await fileHandle.createWritable()
    await writable.write(buffer)
    await writable.close()
  }

  async getCachedRange(
    mediaId: string,
    sampleRate: number,
    startTime: number,
    endTime: number,
  ): Promise<WaveformRange | null> {
    try {
      const dir = await this.ensureDirectory()
      const requestedStartSample = Math.max(0, Math.floor(startTime * sampleRate))
      const requestedEndSample = Math.max(
        requestedStartSample + 1,
        Math.ceil(endTime * sampleRate),
      )
      const candidates: RangeIndex[] = []

      for await (const entry of dir.values()) {
        if (entry.kind !== 'file') continue
        const parsed = this.parseRangeFileName(entry.name)
        if (
          parsed &&
          parsed.mediaId === mediaId &&
          parsed.sampleRate === sampleRate &&
          parsed.startSample < requestedEndSample &&
          parsed.startSample + parsed.sampleCount > requestedStartSample
        ) {
          candidates.push(parsed)
        }
      }

      if (candidates.length === 0) return null
      candidates.sort((a, b) => a.startSample - b.startSample)

      let coveredUntil = requestedStartSample
      const covering: RangeIndex[] = []
      for (const candidate of candidates) {
        const candidateEnd = candidate.startSample + candidate.sampleCount
        if (candidateEnd <= coveredUntil) continue
        if (candidate.startSample > coveredUntil) break
        covering.push(candidate)
        coveredUntil = Math.max(coveredUntil, candidateEnd)
        if (coveredUntil >= requestedEndSample) break
      }

      if (coveredUntil < requestedEndSample) return null

      let duration = 0
      let channels = 1
      let floatsPerSample = 1
      let peaks: Float32Array | null = null

      for (const rangeFile of covering) {
        const fileHandle = await dir.getFileHandle(rangeFile.fileName)
        const file = await fileHandle.getFile()
        const buffer = await file.arrayBuffer()
        const header = this.readRangeHeader(new DataView(buffer.slice(0, RANGE_HEADER_SIZE)))
        if (!header || header.sampleRate !== sampleRate) {
          continue
        }

        duration = Math.max(duration, header.duration)
        channels = header.channels
        floatsPerSample = getFloatsPerSample(channels)
        const totalValues = Math.ceil(header.duration * sampleRate) * floatsPerSample
        if (!peaks) {
          peaks = new Float32Array(totalValues)
        } else if (peaks.length < totalValues) {
          const expanded = new Float32Array(totalValues)
          expanded.set(peaks)
          peaks = expanded
        }

        const rangeValues = new Float32Array(buffer.slice(RANGE_HEADER_SIZE))
        peaks.set(rangeValues, header.startSample * floatsPerSample)
      }

      if (!peaks) return null
      return {
        duration,
        channels,
        sampleRate,
        startSample: requestedStartSample,
        peaks,
      }
    } catch (error) {
      logger.warn(`Failed to read cached waveform range for ${mediaId}:`, error)
      return null
    }
  }

  /**
   * Check if waveform exists
   */
  async exists(mediaId: string): Promise<boolean> {
    try {
      const dir = await this.ensureDirectory()
      await dir.getFileHandle(`${mediaId}.bin`)
      return true
    } catch {
      return false
    }
  }

  /**
   * If OPFS has no binary for this media, try pulling it from the workspace
   * folder and copying it into OPFS. Returns true when a file was restored.
   * Used by all read paths to transparently recover across origins.
   */
  private async hydrateFromWorkspace(mediaId: string): Promise<boolean> {
    try {
      const blob = await readWorkspaceBlob(waveformMultiResPath(mediaId))
      if (!blob || blob.size === 0) return false

      const bytes = await blob.arrayBuffer()
      const dir = await this.ensureDirectory()
      const fileHandle = await dir.getFileHandle(`${mediaId}.bin`, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(bytes)
      await writable.close()
      logger.debug(`Hydrated waveform ${mediaId} from workspace`)
      return true
    } catch (error) {
      logger.warn(`hydrateFromWorkspace(${mediaId}) failed`, error)
      return false
    }
  }

  /**
   * Get waveform metadata without loading data
   */
  async getMetadata(
    mediaId: string,
  ): Promise<{ header: WaveformHeader; levels: LevelIndex[] } | null> {
    try {
      const dir = await this.ensureDirectory()
      let fileHandle: FileSystemFileHandle
      try {
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      } catch {
        if (!(await this.hydrateFromWorkspace(mediaId))) return null
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      }
      const file = await fileHandle.getFile()

      // Read header
      const headerBuffer = await file.slice(0, HEADER_SIZE).arrayBuffer()
      const header = this.readHeader(new DataView(headerBuffer))
      if (!header) return null

      // Read level index
      const indexSize = header.levelCount * LEVEL_INDEX_SIZE
      const indexBuffer = await file.slice(HEADER_SIZE, HEADER_SIZE + indexSize).arrayBuffer()
      const indexView = new DataView(indexBuffer)

      const levels: LevelIndex[] = []
      for (let i = 0; i < header.levelCount; i++) {
        levels.push(this.readLevelIndex(indexView, i))
      }

      return { header, levels }
    } catch {
      return null
    }
  }

  /**
   * Get a specific resolution level (full)
   */
  async getLevel(
    mediaId: string,
    levelIndex: number,
  ): Promise<{ sampleRate: number; peaks: Float32Array; channels: number } | null> {
    try {
      const dir = await this.ensureDirectory()
      let fileHandle
      try {
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      } catch {
        if (!(await this.hydrateFromWorkspace(mediaId))) return null
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      }

      const file = await fileHandle.getFile()

      // Read entire file at once to avoid OPFS concurrency issues with multiple slice() calls
      const buffer = await file.arrayBuffer()
      const view = new DataView(buffer)

      // Parse header
      const header = this.readHeader(view)
      if (!header || levelIndex >= header.levelCount) {
        return null
      }

      // Read level index and extract data
      const level = this.readLevelIndex(view, levelIndex)
      const floatsPerSample = getFloatsPerSample(header.channels)
      const dataSize = level.sampleCount * floatsPerSample * 4 // Float32 = 4 bytes
      const peaks = new Float32Array(buffer.slice(level.offset, level.offset + dataSize))
      return {
        sampleRate: level.sampleRate,
        peaks,
        channels: header.channels,
      }
    } catch (error) {
      // NotFoundError is expected when cache doesn't exist - return null silently
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null
      }
      // RangeError means corrupted/old format data - silently delete so it regenerates
      if (error instanceof RangeError) {
        await this.delete(mediaId).catch(() => {})
        return null
      }
      logger.error(`Failed to get waveform level ${levelIndex} for ${mediaId}:`, error)
      return null
    }
  }

  /**
   * Get a range of samples from a specific level
   * For range-based loading of visible portion only
   */
  async getLevelRange(
    mediaId: string,
    levelIndex: number,
    startTime: number,
    endTime: number,
  ): Promise<{ sampleRate: number; peaks: Float32Array; startSample: number } | null> {
    try {
      const dir = await this.ensureDirectory()
      let fileHandle
      try {
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      } catch {
        if (!(await this.hydrateFromWorkspace(mediaId))) return null
        fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      }
      const file = await fileHandle.getFile()

      // Read entire file at once to avoid OPFS concurrency issues
      const buffer = await file.arrayBuffer()
      const view = new DataView(buffer)

      // Parse header
      const header = this.readHeader(view)
      if (!header || levelIndex >= header.levelCount) return null

      // Read level index
      const level = this.readLevelIndex(view, levelIndex)
      const floatsPerSample = getFloatsPerSample(header.channels)

      // Calculate sample range
      const startSample = Math.max(0, Math.floor(startTime * level.sampleRate))
      const endSample = Math.min(level.sampleCount, Math.ceil(endTime * level.sampleRate))
      const sampleCount = endSample - startSample

      if (sampleCount <= 0) return null

      // Extract range from buffer
      const rangeOffset = level.offset + startSample * floatsPerSample * 4
      const rangeSize = sampleCount * floatsPerSample * 4
      const peaks = new Float32Array(buffer.slice(rangeOffset, rangeOffset + rangeSize))

      return {
        sampleRate: level.sampleRate,
        peaks,
        startSample,
      }
    } catch (error) {
      // RangeError means corrupted/old format data - silently delete so it regenerates
      if (error instanceof RangeError) {
        await this.delete(mediaId).catch(() => {})
        return null
      }
      logger.error(`Failed to get waveform range for ${mediaId}:`, error)
      return null
    }
  }

  /**
   * Load all levels (for full waveform load)
   */
  async getAllLevels(mediaId: string): Promise<MultiResolutionWaveform | null> {
    try {
      const dir = await this.ensureDirectory()
      const fileHandle = await dir.getFileHandle(`${mediaId}.bin`)
      const file = await fileHandle.getFile()

      // Read entire file
      const buffer = await file.arrayBuffer()
      const view = new DataView(buffer)

      // Parse header
      const header = this.readHeader(view)
      if (!header) return null

      // Parse levels
      const levels: { sampleRate: number; peaks: Float32Array }[] = []
      for (let i = 0; i < header.levelCount; i++) {
        const levelIndex = this.readLevelIndex(view, i)
        const floatsPerSample = getFloatsPerSample(header.channels)
        const dataSize = levelIndex.sampleCount * floatsPerSample * 4
        const peaks = new Float32Array(
          buffer.slice(levelIndex.offset, levelIndex.offset + dataSize),
        )
        levels.push({
          sampleRate: levelIndex.sampleRate,
          peaks,
        })
      }

      return {
        duration: header.duration,
        channels: header.channels,
        levels,
      }
    } catch {
      return null
    }
  }

  /**
   * Delete waveform
   */
  async delete(mediaId: string): Promise<void> {
    try {
      const dir = await this.ensureDirectory()
      await dir.removeEntry(`${mediaId}.bin`).catch(() => undefined)
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.startsWith(`${mediaId}.range.`)) {
          await dir.removeEntry(entry.name).catch(() => undefined)
        }
      }
    } catch {
      // File may not exist, ignore
    }
    void removeWorkspaceCacheEntry(waveformMultiResPath(mediaId))
  }

  /**
   * List all stored waveforms
   */
  async list(): Promise<string[]> {
    try {
      const dir = await this.ensureDirectory()
      const mediaIds: string[] = []

      for await (const entry of dir.values()) {
        if (
          entry.kind === 'file' &&
          entry.name.endsWith('.bin') &&
          !this.parseRangeFileName(entry.name)
        ) {
          mediaIds.push(entry.name.replace('.bin', ''))
        }
      }

      return mediaIds
    } catch {
      return []
    }
  }

  /**
   * Get storage usage
   */
  async getStorageUsage(): Promise<{ count: number; totalBytes: number }> {
    try {
      const dir = await this.ensureDirectory()
      let count = 0
      let totalBytes = 0

      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.bin')) {
          count++
          const fileHandle = await dir.getFileHandle(entry.name)
          const file = await fileHandle.getFile()
          totalBytes += file.size
        }
      }

      return { count, totalBytes }
    } catch {
      return { count: 0, totalBytes: 0 }
    }
  }

  /**
   * Clear all waveforms
   */
  async clearAll(): Promise<void> {
    try {
      const dir = await this.ensureDirectory()
      const entries: string[] = []

      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          entries.push(entry.name)
        }
      }

      for (const name of entries) {
        await dir.removeEntry(name)
        // Remove the corresponding workspace mirror so a later hydrate can't
        // silently restore a waveform we just cleared.
        if (name.endsWith('.bin') && !this.parseRangeFileName(name)) {
          const mediaId = name.slice(0, -'.bin'.length)
          await removeWorkspaceCacheEntry(waveformMultiResPath(mediaId))
        }
      }

      logger.debug(`Cleared ${entries.length} waveforms from OPFS`)
    } catch (error) {
      logger.error('Failed to clear waveforms:', error)
    }
  }
}

// Singleton instance
export const waveformOPFSStorage = new WaveformOPFSStorage()
