import type { TextCounter } from '@/types/text'
import { applyEasing } from '@/shared/utils/easing'

export const TEXT_COUNTER_MAX_DECIMALS = 4

export const DEFAULT_TEXT_COUNTER: TextCounter = {
  enabled: true,
  from: 0,
  to: 100,
  decimals: 0,
  prefix: '',
  suffix: '%',
  thousandsSeparator: false,
  easing: 'linear',
}

function clampDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return 0
  return Math.max(0, Math.min(TEXT_COUNTER_MAX_DECIMALS, Math.round(decimals)))
}

/**
 * Default (un-keyframed) counter value: `from` → `to` across the clip, eased.
 * The last frame of the clip lands exactly on `to`.
 */
export function getTextCounterRampValue(
  counter: TextCounter,
  relativeFrame: number,
  durationInFrames: number,
): number {
  const lastFrame = Math.max(1, durationInFrames - 1)
  const progress = applyEasing(relativeFrame / lastFrame, counter.easing)
  return counter.from + (counter.to - counter.from) * progress
}

/**
 * Format a counter value. Uses a fixed `en-US` locale (`.` decimal, `,`
 * grouping) so preview and export render identically on every machine.
 */
export function formatTextCounterValue(counter: TextCounter, value: number): string {
  const decimals = clampDecimals(counter.decimals)
  const safeValue = Number.isFinite(value) ? value : 0
  const factor = 10 ** decimals
  const rounded = Math.round(safeValue * factor) / factor
  // Avoid "-0" once rounding swallows a tiny negative value.
  const normalized = Object.is(rounded, -0) ? 0 : rounded
  const formatted = normalized.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: counter.thousandsSeparator === true,
  })
  return `${counter.prefix ?? ''}${formatted}${counter.suffix ?? ''}`
}

const TEXT_COUNTER_EASINGS = new Set<TextCounter['easing']>([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
])

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Coerce a persisted/untrusted counter into a valid one; undefined drops it. */
export function sanitizeTextCounter(raw: unknown): TextCounter | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const easing = record.easing as TextCounter['easing']
  return {
    enabled: record.enabled !== false,
    from: finiteOr(record.from, DEFAULT_TEXT_COUNTER.from),
    to: finiteOr(record.to, DEFAULT_TEXT_COUNTER.to),
    decimals: clampDecimals(finiteOr(record.decimals, 0)),
    prefix: stringOr(record.prefix),
    suffix: stringOr(record.suffix),
    thousandsSeparator: record.thousandsSeparator === true,
    easing: TEXT_COUNTER_EASINGS.has(easing) ? easing : 'linear',
  }
}
