import { describe, expect, it } from 'vite-plus/test'
import { transitionRegistry } from './index'

describe('built-in transition timing support', () => {
  it('does not advertise spring timing for transitions', () => {
    for (const definition of transitionRegistry.getDefinitions()) {
      expect(definition.supportedTimings, definition.id).not.toContain('spring')
    }
  })
})
