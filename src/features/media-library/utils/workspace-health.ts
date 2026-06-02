import type { MediaHandleValidation } from '@/infrastructure/storage'
import type { MediaMetadata } from '@/types/storage'
import type { BrokenMediaInfo } from '../types'

export interface MediaHealthScanResult {
  media: MediaMetadata
  validation: MediaHandleValidation
}

export interface WorkspaceHealthScanSummary {
  healthyIds: string[]
  broken: BrokenMediaInfo[]
}

type ValidateMediaHandle = (mediaId: string) => Promise<MediaHandleValidation>

export function buildBrokenMediaInfoFromValidation(
  media: MediaMetadata,
  validation: MediaHandleValidation,
): BrokenMediaInfo | null {
  if (validation.kind === 'permission') {
    return {
      mediaId: media.id,
      fileName: media.fileName,
      errorType: 'permission_denied',
    }
  }

  if (validation.kind === 'missing') {
    return {
      mediaId: media.id,
      fileName: media.fileName,
      errorType: 'file_missing',
    }
  }

  return null
}

export function summarizeWorkspaceHealthScan(
  results: MediaHealthScanResult[],
): WorkspaceHealthScanSummary {
  const healthyIds: string[] = []
  const broken: BrokenMediaInfo[] = []

  for (const result of results) {
    if (result.validation.kind === 'ok') {
      healthyIds.push(result.media.id)
      continue
    }

    const brokenInfo = buildBrokenMediaInfoFromValidation(result.media, result.validation)
    if (brokenInfo) {
      broken.push(brokenInfo)
    }
  }

  return { healthyIds, broken }
}

export async function scanWorkspaceMediaHealth(
  mediaItems: MediaMetadata[],
  validateMediaHandle: ValidateMediaHandle,
): Promise<WorkspaceHealthScanSummary> {
  const results = await Promise.all(
    mediaItems.map(async (media) => ({
      media,
      validation: await validateMediaHandle(media.id),
    })),
  )

  return summarizeWorkspaceHealthScan(results)
}
