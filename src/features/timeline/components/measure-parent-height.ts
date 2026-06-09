export function observeParentElementHeight(
  container: HTMLElement | null,
  setHeight: (height: number) => void,
): (() => void) | undefined {
  if (!container) return undefined

  const measure = () => {
    const parent = container.parentElement
    if (parent) {
      setHeight(parent.clientHeight)
    }
  }

  measure()

  const resizeObserver = new ResizeObserver(measure)
  if (container.parentElement) {
    resizeObserver.observe(container.parentElement)
  }

  return () => resizeObserver.disconnect()
}
