// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  extractTelegramPostId,
  fetchTelegramMediaPreview,
  isTelegramPostUrl,
} from './telegram-download'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('telegram-download', () => {
  describe('isTelegramPostUrl', () => {
    it('matches t.me and telegram.me hosts', () => {
      expect(isTelegramPostUrl(new URL('https://t.me/channel/123'))).toBe(true)
      expect(isTelegramPostUrl(new URL('https://telegram.me/channel/123'))).toBe(true)
      expect(isTelegramPostUrl(new URL('https://www.t.me/channel/123'))).toBe(true)
    })

    it('rejects non-telegram hosts', () => {
      expect(isTelegramPostUrl(new URL('https://example.com/channel/123'))).toBe(false)
    })
  })

  describe('extractTelegramPostId', () => {
    it('extracts numeric post id from telegram post url', () => {
      expect(extractTelegramPostId(new URL('https://t.me/some_channel/42'))).toBe(42)
      expect(extractTelegramPostId(new URL('https://telegram.me/some_channel/105/'))).toBe(105)
    })

    it('throws when the url does not end with numeric id', () => {
      expect(() => extractTelegramPostId(new URL('https://t.me/some_channel'))).toThrow(
        /must include a numeric post id/,
      )
      expect(() =>
        extractTelegramPostId(new URL('https://t.me/some_channel/not-a-number')),
      ).toThrow(/must include a numeric post id/)
    })
  })

  describe('fetchTelegramMediaPreview', () => {
    it('returns media previews with normalized media type and thumbnails', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({
          items: [
            { media_id: 101, media_type: 'video', thumbnail_url: '/api/download/files/a.jpg' },
            { media_id: 202, media_type: 'audio', thumbnail_url: null },
          ],
        }),
      } satisfies Partial<Response>)

      const result = await fetchTelegramMediaPreview('https://t.me/channel/123')

      expect(fetchMock).toHaveBeenCalledWith('http://localhost:8200/api/download/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: 'https://t.me/channel/123' }),
      })
      expect(result).toEqual([
        {
          mediaId: 101,
          mediaType: 'video',
          thumbnailUrl: '/api/download/files/a.jpg',
        },
        {
          mediaId: 202,
          mediaType: 'audio',
          thumbnailUrl: null,
        },
      ])
    })
  })
})
