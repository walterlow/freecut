import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('TelegramDownload')

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'])
const TELEGRAM_API_ORIGIN = 'http://localhost:8200'
const TELEGRAM_DOWNLOAD_ENDPOINT = `${TELEGRAM_API_ORIGIN}/api/download/single`

type DownloadSingleResponse = {
  url: string
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

export async function fetchTelegramMediaThroughLocalDownloader(link: string): Promise<Response> {
  const parsedUrl = new URL(link)
  const mediaId = extractTelegramPostId(parsedUrl)

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
