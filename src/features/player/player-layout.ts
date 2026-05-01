export function calculatePlayerContentLayout(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): { scale: number; scaleX: number; scaleY: number; width: number; height: number } {
  const scale =
    containerWidth > 0 && containerHeight > 0 && sourceWidth > 0 && sourceHeight > 0
      ? Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight)
      : 1
  const width = sourceWidth * scale
  const height = sourceHeight * scale

  const nearExactFit =
    containerWidth > 0 &&
    containerHeight > 0 &&
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    Math.abs(containerWidth - width) <= 1 &&
    Math.abs(containerHeight - height) <= 1

  if (nearExactFit) {
    return {
      scale,
      scaleX: containerWidth / sourceWidth,
      scaleY: containerHeight / sourceHeight,
      width: containerWidth,
      height: containerHeight,
    }
  }

  return {
    scale,
    scaleX: scale,
    scaleY: scale,
    width,
    height,
  }
}
