import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const scheduledTasksRef = vi.hoisted(() => ({
  current: [] as Array<() => void>,
}))

const schedulePreviewWorkMock = vi.hoisted(() =>
  vi.fn((task: () => void) => {
    scheduledTasksRef.current.push(task)
    return () => {
      scheduledTasksRef.current = scheduledTasksRef.current.filter(
        (candidate) => candidate !== task,
      )
    }
  }),
)

vi.mock('@/features/media-library/deps/timeline-services', () => ({
  schedulePreviewWork: schedulePreviewWorkMock,
}))

import {
  _resetBackgroundMediaWorkForTest,
  enqueueBackgroundMediaWork,
} from './background-media-work'

async function flushScheduledWork(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve()
    while (scheduledTasksRef.current.length > 0) {
      const task = scheduledTasksRef.current.shift()
      task?.()
      await Promise.resolve()
    }
    if (scheduledTasksRef.current.length === 0) {
      await Promise.resolve()
      if (scheduledTasksRef.current.length === 0) {
        return
      }
    }
  }
}

describe('backgroundMediaWork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetBackgroundMediaWorkForTest()
    scheduledTasksRef.current = []
  })

  it('runs warm jobs before heavy jobs', async () => {
    const events: string[] = []

    enqueueBackgroundMediaWork(
      () => {
        events.push('heavy')
      },
      {
        priority: 'heavy',
      },
    )
    enqueueBackgroundMediaWork(
      () => {
        events.push('warm')
      },
      {
        priority: 'warm',
      },
    )

    await flushScheduledWork()
    await flushScheduledWork()

    expect(events[0]).toBe('warm')
    expect(events).toContain('heavy')
  })

  it('waits for the active job before starting the next one', async () => {
    let releaseFirst: (() => void) | null = null
    const events: string[] = []

    enqueueBackgroundMediaWork(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
          events.push('first-start')
        }),
    )
    enqueueBackgroundMediaWork(() => {
      events.push('second-start')
    })

    await flushScheduledWork()
    expect(events).toEqual(['first-start'])

    ;(releaseFirst as unknown as () => void)()
    await Promise.resolve()
    await flushScheduledWork()
    await flushScheduledWork()

    expect(events).toEqual(['first-start', 'second-start'])
    expect(schedulePreviewWorkMock).toHaveBeenCalled()
  })
})
