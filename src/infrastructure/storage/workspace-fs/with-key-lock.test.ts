import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { withKeyLock, __resetKeyLocksForTesting } from './with-key-lock'

beforeEach(() => {
  __resetKeyLocksForTesting()
})

describe('withKeyLock', () => {
  it('serializes concurrent calls on the same key', async () => {
    const events: string[] = []
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const a = withKeyLock('k', async () => {
      events.push('a:start')
      await delay(20)
      events.push('a:end')
    })
    const b = withKeyLock('k', async () => {
      events.push('b:start')
      await delay(5)
      events.push('b:end')
    })

    await Promise.all([a, b])

    // a must complete entirely before b starts — no interleaving.
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('runs different keys in parallel', async () => {
    const events: string[] = []
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const a = withKeyLock('key-a', async () => {
      events.push('a:start')
      await delay(20)
      events.push('a:end')
    })
    const b = withKeyLock('key-b', async () => {
      events.push('b:start')
      await delay(5)
      events.push('b:end')
    })

    await Promise.all([a, b])

    // b should finish before a (different key, shorter delay).
    expect(events[0]).toBe('a:start')
    expect(events[1]).toBe('b:start')
    expect(events[2]).toBe('b:end')
    expect(events[3]).toBe('a:end')
  })

  it('a rejection in one call does not prevent the next from running', async () => {
    const failing = withKeyLock('k', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')

    const succeeding = await withKeyLock('k', async () => 42)
    expect(succeeding).toBe(42)
  })

  it('preserves the lost-update race without the lock (sanity)', async () => {
    // Without the lock: two concurrent RMWs see the same initial value and
    // one increment is lost. This codifies the race we're protecting against.
    let value = 0
    const rmw = async (): Promise<void> => {
      const v = value
      await new Promise((r) => setTimeout(r, 1))
      value = v + 1
    }
    await Promise.all([rmw(), rmw(), rmw()])
    expect(value).toBe(1) // 3 increments, but only 1 persisted
  })

  it('prevents lost updates when serialized through the lock', async () => {
    let value = 0
    const rmw = () =>
      withKeyLock('counter', async () => {
        const v = value
        await new Promise((r) => setTimeout(r, 1))
        value = v + 1
      })
    await Promise.all([rmw(), rmw(), rmw()])
    expect(value).toBe(3)
  })
})
