const CINEMATIC_4K_SHORT_EDGE = 2160

export interface ExportResolution {
  width: number
  height: number
}

/**
 * Scale a dimension and round to the nearest even number, because most browser
 * video encoders reject odd dimensions.
 */
export function scaleDimension(value: number, scale: number): number {
  const scaled = Math.max(2, Math.round(value * scale))
  return scaled % 2 === 0 ? scaled : scaled + 1
}

export function scaledResolution(
  projectWidth: number,
  projectHeight: number,
  scale: number,
): ExportResolution {
  return {
    width: scaleDimension(projectWidth, scale),
    height: scaleDimension(projectHeight, scale),
  }
}

export function cinematic4KResolution(
  projectWidth: number,
  projectHeight: number,
): ExportResolution {
  const safeWidth = Math.max(2, projectWidth)
  const safeHeight = Math.max(2, projectHeight)
  const shortEdge = Math.min(safeWidth, safeHeight)
  const scale = CINEMATIC_4K_SHORT_EDGE / shortEdge
  return scaledResolution(safeWidth, safeHeight, scale)
}
