import { describe, expect, it } from 'vite-plus/test'
import { joinTranscriptWords, needsTranscriptWordSeparator } from './transcript-text'

describe('transcript text formatting', () => {
  it('keeps spaces between Latin words', () => {
    expect(joinTranscriptWords([' hello', 'world'])).toBe('hello world')
  })

  it('joins Chinese and Japanese tokens without artificial spaces', () => {
    expect(joinTranscriptWords(['昨', '日', '像', '那', '流水'])).toBe('昨日像那流水')
    expect(joinTranscriptWords(['これ', 'は', 'テスト'])).toBe('これはテスト')
  })

  it('does not add a space before punctuation', () => {
    expect(joinTranscriptWords(['Hello', ',', 'world', '!'])).toBe('Hello, world!')
  })

  it('preserves Korean word separators', () => {
    expect(needsTranscriptWordSeparator('안녕하세요', '세계')).toBe(true)
  })
})
