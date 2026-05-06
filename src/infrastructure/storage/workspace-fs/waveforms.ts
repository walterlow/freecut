/**
 * Waveform storage backed by the workspace folder.
 *
 *   media/{mediaId}/cache/waveform/meta.json             ← WaveformMeta (kind:'meta')
 *   media/{mediaId}/cache/waveform/legacy.json           ← WaveformData (pre-bin schema, rare)
 *   media/{mediaId}/cache/waveform/bin-{N}.bin           ← Float32 peaks binary
 *   media/{mediaId}/cache/waveform/bin-{N}.meta.json     ← WaveformBin minus peaks
 *
 * Record ids follow the legacy convention:
 *   - mediaId                       → meta or legacy
 *   - `${mediaId}:bin:${binIndex}`  → bin record
 *
 * This module preserves the exact public API of the legacy IDB module so
 * consumer code doesn't change: saveWaveformRecord discriminates on shape
 * (legacy has no `kind`; meta has kind='meta'; bin has kind='bin').
 */

import type { WaveformBin, WaveformData, WaveformMeta, WaveformRecord } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readArrayBuffer, readJson, removeEntry, writeBlob, writeJsonAtomic } from './fs-primitives'
import { waveformDir, waveformBinPath } from './paths'

const logger = createLogger('WorkspaceFS:Waveforms')

const BIN_KEY_PREFIX = ':bin:'
const LEGACY_FILENAME = 'legacy.json'
const META_FILENAME = 'meta.json'

interface ParsedBinKey {
  mediaId: string
  binIndex: number
}

function parseBinKey(id: string): ParsedBinKey | null {
  const idx = id.indexOf(BIN_KEY_PREFIX)
  if (idx < 0) return null
  const mediaId = id.slice(0, idx)
  const binIndex = Number(id.slice(idx + BIN_KEY_PREFIX.length))
  if (!Number.isFinite(binIndex) || binIndex < 0) return null
  return { mediaId, binIndex }
}

function waveformMetaPath(mediaId: string): string[] {
  return [...waveformDir(mediaId), META_FILENAME]
}

function waveformLegacyPath(mediaId: string): string[] {
  return [...waveformDir(mediaId), LEGACY_FILENAME]
}

function waveformBinMetaPath(mediaId: string, binIndex: number): string[] {
  return [...waveformDir(mediaId), `bin-${binIndex}.meta.json`]
}

/* ────────────────────────────── Read ─────────────────────────────────── */

type StoredLegacy = Omit<WaveformData, 'peaks'>
type StoredMeta = WaveformMeta
type StoredBinMeta = Omit<WaveformBin, 'peaks'>

async function readLegacy(
  root: FileSystemDirectoryHandle,
  mediaId: string,
): Promise<WaveformData | undefined> {
  const meta = await readJson<StoredLegacy>(root, waveformLegacyPath(mediaId))
  if (!meta) return undefined
  const peaks = await readArrayBuffer(root, [...waveformDir(mediaId), 'legacy.bin'])
  if (!peaks) return undefined
  return { ...meta, peaks }
}

async function readMeta(
  root: FileSystemDirectoryHandle,
  mediaId: string,
): Promise<WaveformMeta | undefined> {
  const meta = await readJson<StoredMeta>(root, waveformMetaPath(mediaId))
  return meta ?? undefined
}

async function readBin(
  root: FileSystemDirectoryHandle,
  mediaId: string,
  binIndex: number,
): Promise<WaveformBin | undefined> {
  const meta = await readJson<StoredBinMeta>(root, waveformBinMetaPath(mediaId, binIndex))
  if (!meta) return undefined
  const peaks = await readArrayBuffer(root, waveformBinPath(mediaId, binIndex))
  if (!peaks) return undefined
  return { ...meta, peaks }
}

/* ────────────────────────────── Public API ───────────────────────────── */

/**
 * Legacy getter — returns only pre-bin single-record waveforms.
 * Records with `kind` ('meta' or 'bin') are filtered out, matching
 * the legacy IDB behavior.
 */
export async function getWaveform(id: string): Promise<WaveformData | undefined> {
  const root = requireWorkspaceRoot()
  try {
    if (parseBinKey(id)) return undefined
    return await readLegacy(root, id)
  } catch (error) {
    logger.error(`getWaveform(${id}) failed`, error)
    return undefined
  }
}

export async function getWaveformRecord(id: string): Promise<WaveformRecord | undefined> {
  const root = requireWorkspaceRoot()
  try {
    const binKey = parseBinKey(id)
    if (binKey) {
      return await readBin(root, binKey.mediaId, binKey.binIndex)
    }
    const meta = await readMeta(root, id)
    if (meta) return meta
    return await readLegacy(root, id)
  } catch (error) {
    logger.error(`getWaveformRecord(${id}) failed`, error)
    return undefined
  }
}

export async function getWaveformMeta(mediaId: string): Promise<WaveformMeta | undefined> {
  const record = await readMeta(requireWorkspaceRoot(), mediaId)
  return record?.kind === 'meta' ? record : undefined
}

export async function saveWaveformRecord(data: WaveformRecord): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    if (!('kind' in data)) {
      // Legacy single-record shape.
      const { peaks, ...rest } = data
      await writeJsonAtomic(root, waveformLegacyPath(data.mediaId), rest)
      await writeBlob(root, [...waveformDir(data.mediaId), 'legacy.bin'], new Uint8Array(peaks))
      return
    }
    if (data.kind === 'meta') {
      await writeJsonAtomic(root, waveformMetaPath(data.mediaId), data)
      return
    }
    if (data.kind === 'bin') {
      const { peaks, ...rest } = data
      await writeJsonAtomic(root, waveformBinMetaPath(data.mediaId, data.binIndex), rest)
      await writeBlob(root, waveformBinPath(data.mediaId, data.binIndex), new Uint8Array(peaks))
      return
    }
  } catch (error) {
    logger.error(`saveWaveformRecord(${data.id}) failed`, error)
    throw error
  }
}

export async function saveWaveformMeta(meta: WaveformMeta): Promise<void> {
  await saveWaveformRecord(meta)
}

export async function saveWaveformBin(bin: WaveformBin): Promise<void> {
  await saveWaveformRecord(bin)
}

export async function getWaveformBins(
  mediaId: string,
  binCount: number,
): Promise<(WaveformBin | undefined)[]> {
  const root = requireWorkspaceRoot()
  try {
    const bins = await Promise.all(
      Array.from({ length: binCount }, (_, i) => readBin(root, mediaId, i)),
    )
    return bins
  } catch (error) {
    logger.error(`getWaveformBins(${mediaId}) failed`, error)
    return []
  }
}

export async function deleteWaveform(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    const binKey = parseBinKey(id)
    const mediaId = binKey?.mediaId ?? id
    await removeEntry(root, waveformDir(mediaId), { recursive: true })
  } catch (error) {
    logger.error(`deleteWaveform(${id}) failed`, error)
    throw new Error(`Failed to delete waveform: ${id}`)
  }
}
