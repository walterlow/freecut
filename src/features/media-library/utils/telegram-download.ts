import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('TelegramDownload')

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'])
const TELEGRAM_API_ORIGIN = 'http://localhost:8200'
const TELEGRAM_PREVIEW_ENDPOINT = `${TELEGRAM_API_ORIGIN}/api/download/preview`
const TELEGRAM_DOWNLOAD_ENDPOINT = `${TELEGRAM_API_ORIGIN}/api/download/single`

type DownloadSingleResponse = {
  url: string
}

type DownloadPreviewResponse = {
  items: Array<{
    media_id: number
    thumbnail_url?: string | null
    media_type?: string
  }>
}

export interface TelegramMediaPreviewItem {
  mediaId: number
  thumbnailUrl: string | null
  mediaType: string
}

function parseDownloadUrl(payload: DownloadSingleResponse): string | null {
  const candidate = payload.url
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null
  }

  try {
    return new URL(candidate.trim(), TELEGRAM_API_ORIGIN).toString()
  } catch {
    return null
  }
}

export function isTelegramPostUrl(url: URL): boolean {
  return TELEGRAM_HOSTS.has(url.hostname.toLowerCase())
}

export function extractTelegramPostId(url: URL): number {
  const match = url.pathname.match(/\/(\d+)\/?$/)
  const postIdText = match?.[1]
  if (!postIdText) {
    throw new Error('Telegram URL must include a numeric post id, e.g. https://t.me/channel/123.')
  }

  const postId = Number.parseInt(postIdText, 10)
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    throw new Error('Telegram post id is invalid.')
  }

  return postId
}

function normalizeThumbnailUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  try {
    const resolved = new URL(value.trim(), TELEGRAM_API_ORIGIN)
    if (resolved.origin === TELEGRAM_API_ORIGIN) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`
    }
    return resolved.toString()
  } catch {
    return null
  }
}

export async function fetchTelegramMediaPreview(link: string): Promise<TelegramMediaPreviewItem[]> {
  let previewResponse: Response
  try {
    previewResponse = await fetch(TELEGRAM_PREVIEW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ link }),
    })
  } catch (error) {
    logger.warn(`Failed to reach Telegram preview endpoint for URL "${link}":`, error)
    throw new Error('Could not reach Telegram preview at localhost:8200.')
  }

  if (!previewResponse.ok) {
    throw new Error(
      `Telegram preview failed (${previewResponse.status}${previewResponse.statusText ? ` ${previewResponse.statusText}` : ''}).`,
    )
  }

  let payload: DownloadPreviewResponse
  try {
    payload = (await previewResponse.json()) as DownloadPreviewResponse
  } catch {
    throw new Error('Telegram preview returned invalid JSON.')
  }

  if (!Array.isArray(payload.items)) {
    throw new Error('Telegram preview response is missing the items list.')
  }

  const items = payload.items
    .map((item) => {
      if (!Number.isSafeInteger(item.media_id) || item.media_id <= 0) {
        return null
      }

      return {
        mediaId: item.media_id,
        thumbnailUrl: normalizeThumbnailUrl(item.thumbnail_url),
        mediaType:
          typeof item.media_type === 'string' && item.media_type.trim().length > 0
            ? item.media_type.trim().toLowerCase()
            : 'unknown',
      } satisfies TelegramMediaPreviewItem
    })
    .filter((item): item is TelegramMediaPreviewItem => item !== null)

  if (items.length === 0) {
    throw new Error('Telegram preview returned no downloadable media.')
  }

  return items
}

export async function fetchTelegramMediaThroughLocalDownloader(
  link: string,
  mediaIdOverride?: number,
): Promise<Response> {
  const parsedUrl = new URL(link)
  const mediaId = mediaIdOverride ?? extractTelegramPostId(parsedUrl)

  let downloadResponse: Response
  try {
    downloadResponse = await fetch(TELEGRAM_DOWNLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        link,
        media_id: mediaId,
      }),
    })
  } catch (error) {
    logger.warn(`Failed to reach local Telegram downloader for URL "${link}":`, error)
    throw new Error('Could not reach the local Telegram downloader at localhost:8200.')
  }

  if (!downloadResponse.ok) {
    throw new Error(
      `Telegram downloader failed (${downloadResponse.status}${downloadResponse.statusText ? ` ${downloadResponse.statusText}` : ''}).`,
    )
  }

  const responseType = downloadResponse.headers.get('content-type')?.toLowerCase() ?? ''
  if (!responseType.includes('application/json')) {
    return downloadResponse
  }

  let payload: DownloadSingleResponse
  try {
    payload = (await downloadResponse.json()) as DownloadSingleResponse
  } catch {
    throw new Error('Telegram downloader returned invalid JSON.')
  }

  const downloadUrl = parseDownloadUrl(payload)
  if (!downloadUrl) {
    throw new Error('Telegram downloader response did not include a downloadable media URL.')
  }

  let mediaResponse: Response
  try {
    mediaResponse = await fetch(downloadUrl)
  } catch (error) {
    logger.warn(`Failed to fetch Telegram media URL "${downloadUrl}":`, error)
    throw new Error('Telegram downloader returned a media URL that could not be fetched.')
  }

  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download Telegram media (${mediaResponse.status}${mediaResponse.statusText ? ` ${mediaResponse.statusText}` : ''}).`,
    )
  }

  return mediaResponse
}
