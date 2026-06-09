export function addWindowPointerListeners(
  handlePointerMove: (event: PointerEvent) => void,
  handlePointerUp: (event: PointerEvent) => void,
): () => void {
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)

  return () => {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  }
}
