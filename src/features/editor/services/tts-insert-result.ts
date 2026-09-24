import { importMediaLibraryService } from '@/features/editor/deps/media-library'
import { insertAndLinkTtsAudioAtTextItem } from '@/features/editor/utils/insert-tts-generated-audio'
import type { TtsTranslate } from '@/features/editor/utils/tts-generate-options'

export interface TtsInsertResult {
  file: File
  objectUrl: string
  tags: string[]
}

export interface TtsInsertRequest extends TtsInsertResult {
  projectId: string
  sourceItemId: string
}

export type TtsInsertOutcome =
  | { ok: true; inserted: boolean; fileName: string }
  | { ok: false; message: string }

const TTS_INSERT_NOTIFICATIONS = {
  inserted: { type: 'success', key: 'editor.tts.notifications.addedAndLinked' },
  saved: { type: 'warning', key: 'editor.tts.notifications.savedNoTrack' },
} as const

/** Insert request for a finished generation, or null while one of its inputs is missing. */
export function getTtsInsertRequest(
  result: TtsInsertResult | null,
  projectId: string | null,
  sourceItemId: string | null,
): TtsInsertRequest | null {
  if (!result || !projectId || !sourceItemId) return null

  return {
    file: result.file,
    objectUrl: result.objectUrl,
    tags: result.tags,
    projectId,
    sourceItemId,
  }
}

/** Import the generated file into the media library, then place and link it on the timeline. */
export async function insertTtsResult(
  request: TtsInsertRequest,
  loadMediaItems: () => Promise<void>,
  fallbackMessage: string,
): Promise<TtsInsertOutcome> {
  try {
    const { mediaLibraryService } = await importMediaLibraryService()
    const media = await mediaLibraryService.importGeneratedAudio(request.file, request.projectId, {
      tags: request.tags,
    })

    await loadMediaItems()

    const { inserted } = insertAndLinkTtsAudioAtTextItem(
      media,
      request.objectUrl,
      request.sourceItemId,
    )

    return { ok: true, inserted, fileName: media.fileName }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : fallbackMessage,
    }
  }
}

export function resolveTtsInsertNotification(
  inserted: boolean,
  fileName: string,
  t: TtsTranslate,
): { type: 'success' | 'warning'; message: string } {
  const preset = inserted ? TTS_INSERT_NOTIFICATIONS.inserted : TTS_INSERT_NOTIFICATIONS.saved

  return { type: preset.type, message: t(preset.key, { fileName }) }
}
