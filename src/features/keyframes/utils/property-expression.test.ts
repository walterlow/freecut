// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { evaluatePropertyExpression, isExpressionValueCompatible } from './property-expression'

describe('property expression sandbox', () => {
  const context = {
    preValue: 10,
    globalFrame: 30,
    fps: 30,
    resolveProperty: vi.fn((itemId: string, property: string) =>
      itemId === 'source' && property === 'x' ? 20 : null,
    ),
  }

  it('evaluates deterministic arithmetic, time, and property references', () => {
    expect(evaluatePropertyExpression('value + prop("source", "x") * time', context)).toEqual({
      value: 30,
    })
  })

  it('supports component-wise Vector2 math', () => {
    const result = evaluatePropertyExpression('lerp(value, [100, 200], 0.5)', {
      ...context,
      preValue: { x: 0, y: 20 },
    })

    expect(result).toEqual({ value: { x: 50, y: 110 } })
    expect(isExpressionValueCompatible('position', result.value)).toBe(true)
    expect(isExpressionValueCompatible('x', result.value)).toBe(false)
  })

  it('falls back to the pre-expression value with a useful error', () => {
    expect(evaluatePropertyExpression('value / 0', context)).toEqual({
      value: 10,
      error: 'Division by zero',
    })
    expect(evaluatePropertyExpression('window.alert(1)', context).error).toMatch(
      /invalid number|unexpected character/i,
    )
  })
})
