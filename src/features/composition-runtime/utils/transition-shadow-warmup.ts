import type { VideoItem } from '@/types/timeline';

export interface TransitionShadowWarmupItem extends VideoItem {
  _poolClipId?: string;
}

export interface TransitionShadowWarmupRequest {
  sourceUrl: string;
  minTotalLanes: number;
  targetTimeSeconds: number[];
}

export function buildTransitionShadowWarmupRequests(
  activeItem: TransitionShadowWarmupItem | null,
  shadowItems: TransitionShadowWarmupItem[],
): TransitionShadowWarmupRequest[] {
  if (!activeItem?.src || shadowItems.length === 0) {
    return [];
  }

  const requests = new Map<string, TransitionShadowWarmupRequest>();

  const ensureRequest = (sourceUrl: string): TransitionShadowWarmupRequest => {
    const existing = requests.get(sourceUrl);
    if (existing) {
      return existing;
    }

    const next: TransitionShadowWarmupRequest = {
      sourceUrl,
      minTotalLanes: 0,
      targetTimeSeconds: [],
    };
    requests.set(sourceUrl, next);
    return next;
  };

  ensureRequest(activeItem.src).minTotalLanes += 1;

  for (const shadowItem of shadowItems) {
    if (!shadowItem.src) continue;
    const sourceFps = shadowItem.sourceFps ?? activeItem.sourceFps ?? 30;
    const targetTimeSeconds = (shadowItem.sourceStart ?? shadowItem.trimStart ?? shadowItem.offset ?? 0) / sourceFps;
    const request = ensureRequest(shadowItem.src);
    request.minTotalLanes += 1;
    request.targetTimeSeconds.push(targetTimeSeconds);
  }

  return [...requests.values()];
}
