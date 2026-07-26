// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { extractTelegramPostId, isTelegramPostUrl } from './telegram-download'

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
})
