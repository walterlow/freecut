/**
 * Decoded preview audio (for non-browser codecs like AC-3/EC-3) backed by
 * the workspace folder.
 *
 *   media/{mediaId}/cache/decoded-audio/meta.json            ← DecodedPreviewAudioMeta
 *   media/{mediaId}/cache/decoded-audio/bin-{N}.meta.json    ← DecodedPreviewAudioBin minus {left,right}
 *   media/{mediaId}/cache/decoded-audio/left-{N}.bin         ← Int16 PCM binary (left channel)
 *   media/{mediaId}/cache/decoded-audio/right-{N}.bin        ← Int16 PCM binary (right channel)
 *
 * Preserves the legacy API exactly: `get/saveDecodedPreviewAudio(id)`
 * where id is either `mediaId` (meta) or `${mediaId}:bin:${binIndex}` (bin).
 */

import type {
  DecodedPreviewAudio,
  DecodedPreviewAudioBin,
  DecodedPreviewAudioMeta,
} from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readArrayBuffer, readJson, removeEntry, writeBlob, writeJsonAtomic } from './fs-primitives'
import { decodedAudioBinPath, decodedAudioDir } from './paths'

const logger = createLogger('WorkspaceFS:DecodedAudio')

const BIN_KEY_PREFIX = ':bin:'
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

function decodedAudioMetaPath(mediaId: string): string[] {
  return [...decodedAudioDir(mediaId), META_FILENAME]
}

function decodedAudioBinMetaPath(mediaId: string, binIndex: number): string[] {
  return [...decodedAudioDir(mediaId), `bin-${binIndex}.meta.json`]
}

/* ────────────────────────────── Read ─────────────────────────────────── */

type StoredBinMeta = Omit<DecodedPreviewAudioBin, 'left' | 'right'>

async function readMeta(
  root: FileSystemDirectoryHandle,
  mediaId: string,
): Promise<DecodedPreviewAudioMeta | undefined> {
  const meta = await readJson<DecodedPreviewAudioMeta>(root, decodedAudioMetaPath(mediaId))
  return meta ?? undefined
}

async function readBin(
  root: FileSystemDirectoryHandle,
  mediaId: string,
  binIndex: number,
): Promise<DecodedPreviewAudioBin | undefined> {
  const binMeta = await readJson<StoredBinMeta>(root, decodedAudioBinMetaPath(mediaId, binIndex))
  if (!binMeta) return undefined
  const left = await readArrayBuffer(root, decodedAudioBinPath(mediaId, 'left', binIndex))
  const right = await readArrayBuffer(root, decodedAudioBinPath(mediaId, 'right', binIndex))
  if (!left || !right) return undefined
  return { ...binMeta, left, right }
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getDecodedPreviewAudio(id: string): Promise<DecodedPreviewAudio | undefined> {
  const root = requireWorkspaceRoot()
  try {
    const binKey = parseBinKey(id)
    if (binKey) {
      return await readBin(root, binKey.mediaId, binKey.binIndex)
    }
    return await readMeta(root, id)
  } catch (error) {
    logger.error(`getDecodedPreviewAudio(${id}) failed`, error)
    return undefined
  }
}

export async function saveDecodedPreviewAudio(data: DecodedPreviewAudio): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    if (data.kind === 'meta') {
      await writeJsonAtomic(root, decodedAudioMetaPath(data.mediaId), data)
      return
    }
    if (data.kind === 'bin') {
      const { left, right, ...rest } = data
      await writeJsonAtomic(root, decodedAudioBinMetaPath(data.mediaId, data.binIndex), rest)
      await writeBlob(
        root,
        decodedAudioBinPath(data.mediaId, 'left', data.binIndex),
        new Uint8Array(left),
      )
      await writeBlob(
        root,
        decodedAudioBinPath(data.mediaId, 'right', data.binIndex),
        new Uint8Array(right),
      )
      return
    }
  } catch (error) {
    logger.error(`saveDecodedPreviewAudio(${data.id}) failed`, error)
    throw error
  }
}

export async function deleteDecodedPreviewAudio(mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await removeEntry(root, decodedAudioDir(mediaId), { recursive: true })
  } catch (error) {
    logger.error(`deleteDecodedPreviewAudio(${mediaId}) failed`, error)
  }
}
