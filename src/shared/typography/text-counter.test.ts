import { describe, expect, it } from 'vite-plus/test'
import type { TextCounter } from '@/types/text'
import {
  formatTextCounterValue,
  getTextCounterRampValue,
  sanitizeTextCounter,
} from './text-counter'

const base: TextCounter = {
  enabled: true,
  from: 0,
  to: 100,
  decimals: 0,
  easing: 'linear',
}

describe('formatTextCounterValue', () => {
  it('applies decimals, prefix and suffix', () => {
    expect(formatTextCounterValue({ ...base, decimals: 1, prefix: '$', suffix: 'k' }, 12.345)).toBe(
      '$12.3k',
    )
  })

  it('groups thousands only when enabled', () => {
    expect(formatTextCounterValue(base, 1234567)).toBe('1234567')
    expect(formatTextCounterValue({ ...base, thousandsSeparator: true }, 1234567)).toBe(
      '1,234,567',
    )
  })

  it('never renders negative zero', () => {
    expect(formatTextCounterValue(base, -0.2)).toBe('0')
  })

  it('clamps decimals and tolerates non-finite values', () => {
    expect(formatTextCounterValue({ ...base, decimals: 9 }, 1)).toBe('1.0000')
    expect(formatTextCounterValue(base, Number.NaN)).toBe('0')
  })
})

describe('getTextCounterRampValue', () => {
  it('lands exactly on `to` at the last frame', () => {
    expect(getTextCounterRampValue(base, 0, 30)).toBe(0)
    expect(getTextCounterRampValue(base, 29, 30)).toBe(100)
  })

  it('counts down when `to` < `from`', () => {
    expect(getTextCounterRampValue({ ...base, from: 10, to: 0 }, 5, 11)).toBe(5)
  })

  it('handles single-frame clips', () => {
    expect(getTextCounterRampValue(base, 0, 1)).toBe(0)
  })
})

describe('sanitizeTextCounter', () => {
  it('drops non-objects and coerces malformed fields', () => {
    expect(sanitizeTextCounter(null)).toBeUndefined()
    expect(
      sanitizeTextCounter({ from: 'x', to: 50, decimals: 7.6, easing: 'bounce', prefix: 3 }),
    ).toEqual({
      enabled: true,
      from: 0,
      to: 50,
      decimals: 4,
      prefix: '',
      suffix: '',
      thousandsSeparator: false,
      easing: 'linear',
    })
  })
})
