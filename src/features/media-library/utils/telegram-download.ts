import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('TelegramDownload')

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'])
const TELEGRAM_PREVIEW_PATH = '/api/download/preview'
const TELEGRAM_DOWNLOAD_PATH = '/api/download/single'

/**
 * Origin of the Telegram download server. Defaults to an empty string so
 * requests use relative paths (`/api/...`) — in dev the Vite proxy routes
 * those, and in production nginx proxies them. Set VITE_TELEGRAM_DOWNLOADER_URL
 * at build time only when the downloader lives on a different origin (CORS
 * must then be enabled on the downloader side).
 */
function getTelegramApiOrigin(): string {
  const configured =
    typeof import.meta.env !== 'undefined'
      ? import.meta.env.VITE_TELEGRAM_DOWNLOADER_URL
      : undefined
  if (typeof configured !== 'string' || configured.trim().length === 0) {
    return ''
  }
  return configured.trim().replace(/\/+$/, '')
}

/** Full endpoint URL or a relative path when the origin is left unset. */
function telegramEndpoint(path: string): string {
  const origin = getTelegramApiOrigin()
  return origin ? `${origin}${path}` : path
}

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

function parseDownloadUrl(payload: DownloadSingleResponse, apiOrigin: string): string | null {
  const candidate = payload.url
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null
  }

  const trimmed = candidate.trim()
  if (!apiOrigin) {
    return trimmed
  }
  try {
    return new URL(trimmed, apiOrigin).toString()
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

function normalizeThumbnailUrl(value: string | null | undefined, apiOrigin: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const trimmed = value.trim()
  if (!apiOrigin) {
    return trimmed
  }
  try {
    return new URL(trimmed, apiOrigin).toString()
  } catch {
    return null
  }
}

export async function fetchTelegramMediaPreview(link: string): Promise<TelegramMediaPreviewItem[]> {
  const apiOrigin = getTelegramApiOrigin()
  const endpoint = telegramEndpoint(TELEGRAM_PREVIEW_PATH)
  let previewResponse: Response
  try {
    previewResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    })
  } catch (error) {
    logger.warn(`Failed to reach Telegram preview endpoint for URL "${link}":`, error)
    throw new Error(
      apiOrigin
        ? `Could not reach Telegram preview at ${apiOrigin}.`
        : 'Could not reach Telegram preview. Make sure the /api proxy is configured.',
    )
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
        thumbnailUrl: normalizeThumbnailUrl(item.thumbnail_url, apiOrigin),
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
  const apiOrigin = getTelegramApiOrigin()
  const parsedUrl = new URL(link)
  const mediaId = mediaIdOverride ?? extractTelegramPostId(parsedUrl)

  let downloadResponse: Response
  try {
    downloadResponse = await fetch(telegramEndpoint(TELEGRAM_DOWNLOAD_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        link,
        media_id: mediaId,
      }),
    })
  } catch (error) {
    logger.warn(`Failed to reach the Telegram downloader for URL "${link}":`, error)
    throw new Error(
      apiOrigin
        ? `Could not reach the Telegram downloader at ${apiOrigin}.`
        : 'Could not reach the Telegram downloader. Make sure the /api proxy is configured.',
    )
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

  const downloadUrl = parseDownloadUrl(payload, apiOrigin)
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
