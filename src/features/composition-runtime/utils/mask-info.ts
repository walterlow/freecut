import type { MaskInfo } from '../components/item';
import type { ResolvedShapeMask } from './frame-scene';
import { doesMaskAffectTrack } from '@/shared/utils/mask-scope';

export const EMPTY_MASK_INFOS: MaskInfo[] = [];

function toMaskInfo({ shape, transform, trackOrder }: ResolvedShapeMask): MaskInfo {
  return {
    shape,
    trackOrder,
    transform: {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: transform.rotation,
      opacity: transform.opacity,
      cornerRadius: transform.cornerRadius,
    },
  };
}

function sameMaskTransform(a: MaskInfo['transform'], b: MaskInfo['transform']): boolean {
  return (
    a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
    && a.rotation === b.rotation
    && a.opacity === b.opacity
    && a.cornerRadius === b.cornerRadius
  );
}

export function materializeMaskInfos(resolvedMasks: ResolvedShapeMask[]): MaskInfo[] {
  if (resolvedMasks.length === 0) return EMPTY_MASK_INFOS;
  return resolvedMasks.map(toMaskInfo);
}

export function reuseStableMaskInfos(previous: MaskInfo[], next: MaskInfo[]): MaskInfo[] {
  if (next.length === 0) return EMPTY_MASK_INFOS;
  if (previous.length === 0) return next;

  let changed = previous.length !== next.length;
  const merged = next.map((mask, index) => {
    const previousMask = previous[index];
    if (
      previousMask
      && previousMask.shape === mask.shape
      && previousMask.trackOrder === mask.trackOrder
      && sameMaskTransform(previousMask.transform, mask.transform)
    ) {
      return previousMask;
    }
    changed = true;
    return mask;
  });

  return changed ? merged : previous;
}

export function getMasksForTrackOrder(masks: MaskInfo[], itemTrackOrder: number): MaskInfo[] {
  if (masks.length === 0) return EMPTY_MASK_INFOS;

  const applicableMasks = masks.filter((mask) => doesMaskAffectTrack(mask.trackOrder, itemTrackOrder));
  if (applicableMasks.length === 0) return EMPTY_MASK_INFOS;
  return applicableMasks.length === masks.length ? masks : applicableMasks;
}
