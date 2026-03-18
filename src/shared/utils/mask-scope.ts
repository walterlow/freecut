export function doesMaskAffectTrack(maskTrackOrder: number, itemTrackOrder: number): boolean {
  return maskTrackOrder < itemTrackOrder;
}
