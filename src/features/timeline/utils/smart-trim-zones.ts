export type SmartTrimIntent =
  | 'trim-start'
  | 'trim-end'
  | 'ripple-start'
  | 'ripple-end'
  | 'roll-start'
  | 'roll-end'
  | 'track-push'
  | null
export type SmartBodyIntent = 'slip-body' | 'slide-body' | null

export const SMART_TRIM_EDGE_ZONE_PX = 12
export const SMART_TRIM_ROLL_ZONE_PX = 4
export const SMART_TRIM_RETENTION_PX = 2

interface ResolveSmartTrimIntentParams {
  x: number
  width: number
  hasLeftNeighbor: boolean
  hasRightNeighbor: boolean
  hasStartBridge?: boolean
  hasEndBridge?: boolean
  preferRippleOuterEdges?: boolean
  currentIntent?: SmartTrimIntent
  edgeZonePx?: number
  rollZonePx?: number
  retentionPx?: number
}

export function resolveSmartTrimIntent({
  x,
  width,
  hasLeftNeighbor,
  hasRightNeighbor,
  hasStartBridge = false,
  hasEndBridge = false,
  preferRippleOuterEdges = false,
  currentIntent = null,
  edgeZonePx = SMART_TRIM_EDGE_ZONE_PX,
  rollZonePx = SMART_TRIM_ROLL_ZONE_PX,
  retentionPx = SMART_TRIM_RETENTION_PX,
}: ResolveSmartTrimIntentParams): SmartTrimIntent {
  if (width <= 0) return null

  const resolveOuterIntent = (edge: 'start' | 'end'): SmartTrimIntent => {
    if (edge === 'start') {
      return preferRippleOuterEdges || hasStartBridge ? 'ripple-start' : 'trim-start'
    }
    return preferRippleOuterEdges || hasEndBridge ? 'ripple-end' : 'trim-end'
  }

  const distanceToStart = Math.max(0, x)
  const distanceToEnd = Math.max(0, width - x)

  if (
    currentIntent === 'roll-start' ||
    currentIntent === 'trim-start' ||
    currentIntent === 'ripple-start'
  ) {
    if (
      distanceToStart <= edgeZonePx + retentionPx &&
      distanceToStart <= distanceToEnd + retentionPx
    ) {
      if (
        hasLeftNeighbor &&
        currentIntent === 'roll-start' &&
        distanceToStart <= rollZonePx + retentionPx
      ) {
        return 'roll-start'
      }
      if (
        hasLeftNeighbor &&
        (currentIntent === 'trim-start' || currentIntent === 'ripple-start') &&
        distanceToStart <= Math.max(2, rollZonePx - 2)
      ) {
        return 'roll-start'
      }
      return resolveOuterIntent('start')
    }
  }

  if (
    currentIntent === 'roll-end' ||
    currentIntent === 'trim-end' ||
    currentIntent === 'ripple-end'
  ) {
    if (
      distanceToEnd <= edgeZonePx + retentionPx &&
      distanceToEnd <= distanceToStart + retentionPx
    ) {
      if (
        hasRightNeighbor &&
        currentIntent === 'roll-end' &&
        distanceToEnd <= rollZonePx + retentionPx
      ) {
        return 'roll-end'
      }
      if (
        hasRightNeighbor &&
        (currentIntent === 'trim-end' || currentIntent === 'ripple-end') &&
        distanceToEnd <= Math.max(2, rollZonePx - 2)
      ) {
        return 'roll-end'
      }
      return resolveOuterIntent('end')
    }
  }

  const closestEdge = distanceToStart <= distanceToEnd ? 'start' : 'end'
  const closestDistance = closestEdge === 'start' ? distanceToStart : distanceToEnd

  if (closestDistance > edgeZonePx) return null

  if (closestEdge === 'start') {
    if (hasLeftNeighbor && closestDistance <= rollZonePx) {
      return 'roll-start'
    }
    return resolveOuterIntent('start')
  }

  if (hasRightNeighbor && closestDistance <= rollZonePx) {
    return 'roll-end'
  }
  return resolveOuterIntent('end')
}

export function smartTrimIntentToHandle(intent: SmartTrimIntent): 'start' | 'end' | null {
  if (
    intent === 'trim-start' ||
    intent === 'ripple-start' ||
    intent === 'roll-start' ||
    intent === 'track-push'
  )
    return 'start'
  if (intent === 'trim-end' || intent === 'ripple-end' || intent === 'roll-end') return 'end'
  return null
}

export function smartTrimIntentToMode(intent: SmartTrimIntent): 'rolling' | 'ripple' | null {
  if (intent === 'roll-start' || intent === 'roll-end') return 'rolling'
  if (intent === 'ripple-start' || intent === 'ripple-end') return 'ripple'
  return null
}

interface ResolveSmartBodyIntentParams {
  y: number
  height: number
  labelRowHeight: number
  isMediaItem: boolean
  currentIntent?: SmartBodyIntent
  slideToSlipBufferPx?: number
  slipToSlideBufferPx?: number
}

export function resolveSmartBodyIntent({
  y,
  height,
  labelRowHeight,
  isMediaItem,
  currentIntent = null,
  slideToSlipBufferPx = 8,
  slipToSlideBufferPx = 2,
}: ResolveSmartBodyIntentParams): SmartBodyIntent {
  if (!isMediaItem || height <= 0) return null
  if (y < 0 || y > height) return null

  const safeLabelRowHeight = Math.max(0, Math.min(labelRowHeight, height))
  if (safeLabelRowHeight <= 0 || safeLabelRowHeight >= height) return null

  if (currentIntent === 'slide-body') {
    return y <= safeLabelRowHeight + slideToSlipBufferPx ? 'slide-body' : 'slip-body'
  }

  if (currentIntent === 'slip-body') {
    return y >= safeLabelRowHeight - slipToSlideBufferPx ? 'slip-body' : 'slide-body'
  }

  return y <= safeLabelRowHeight ? 'slide-body' : 'slip-body'
}
