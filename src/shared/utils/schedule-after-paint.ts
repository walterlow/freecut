export function scheduleAfterPaint(task: () => void): () => void {
  if (typeof window === 'undefined') {
    const timeoutId = setTimeout(task, 0)
    return () => clearTimeout(timeoutId)
  }

  let timeoutId: number | null = null
  const rafId = window.requestAnimationFrame(() => {
    timeoutId = window.setTimeout(task, 0)
  })

  return () => {
    window.cancelAnimationFrame(rafId)
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }
}
