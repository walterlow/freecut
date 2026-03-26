interface LinkedSyncBadgeSuppressionParams {
  linkedSelectionEnabled: boolean;
  linkedEditPreviewActive: boolean;
  isDragging: boolean;
  isPartOfDrag: boolean;
  isTrimming: boolean;
  isStretching: boolean;
  isSlipSlideActive: boolean;
  rollingEditDelta: number;
  rippleEditOffset: number;
  rippleEdgeDelta: number;
  slipEditDelta: number;
  slideEditOffset: number;
  slideNeighborDelta: number;
}

export function shouldSuppressLinkedSyncBadge(params: LinkedSyncBadgeSuppressionParams): boolean {
  if (!params.linkedSelectionEnabled) {
    return false;
  }

  if (params.isDragging || params.isPartOfDrag) {
    return false;
  }

  return params.linkedEditPreviewActive
    || params.isTrimming
    || params.isStretching
    || params.isSlipSlideActive
    || params.rollingEditDelta !== 0
    || params.rippleEditOffset !== 0
    || params.rippleEdgeDelta !== 0
    || params.slipEditDelta !== 0
    || params.slideEditOffset !== 0
    || params.slideNeighborDelta !== 0;
}
