import { describe, expect, it } from 'vite-plus/test'
import { getAvailableFixtures, generateFixture } from './test-fixtures'
import { validateSnapshotData } from './json-import-service'

describe('test fixtures', () => {
  it('generates snapshots accepted by the current import validator', async () => {
    for (const fixture of getAvailableFixtures()) {
      const { snapshot } = generateFixture(fixture.type)
      const result = await validateSnapshotData(snapshot)

      expect(result.errors, fixture.type).toEqual([])
      expect(result.valid, fixture.type).toBe(true)
    }
  })
})
