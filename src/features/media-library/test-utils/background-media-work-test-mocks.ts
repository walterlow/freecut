type ViWithFn = Pick<(typeof import('vite-plus/test'))['vi'], 'fn'>

export function createBackgroundMediaWorkMocks(vi: ViWithFn) {
  return {
    enqueueBackgroundMediaWork: vi.fn((run: () => unknown) => {
      const result = run()
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void (result as PromiseLike<unknown>)
      }
      return vi.fn()
    }),
  }
}
