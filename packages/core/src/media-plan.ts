import type { FrameRange } from './range.js';

export interface MediaUsageItem {
  id: string | undefined;
  type: string | undefined;
  label: string;
  from: number;
  durationInFrames: number;
  trackId: string | null;
}

export interface MediaUsage {
  mediaId: string;
  itemCount: number;
  items: MediaUsageItem[];
}

export interface MediaItemLike {
  id?: string;
  type?: string;
  mediaId?: string;
  compositionId?: string;
  label?: string;
  from?: number;
  durationInFrames?: number;
  trackId?: string | null;
  src?: unknown;
}

export interface MediaTrackLike {
  id?: string;
  items?: MediaItemLike[];
}

export interface MediaUsageOptions {
  requireExternalSource?: boolean;
}

export interface RenderMediaSource {
  url: string;
  audioUrl?: string;
  keyframeTimestamps?: number[];
}

export type RenderMediaSourceInput = string | RenderMediaSource;
export type RenderMediaSourcesInput = Record<string, RenderMediaSourceInput> | null | undefined;

export interface RenderMediaSourcePlan {
  ok: boolean;
  requiredMediaIds: string[];
  missingMediaIds: string[];
  unusedMediaIds: string[];
  sources: Map<string, RenderMediaSource>;
}

const MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image']);

export function collectProjectMediaUsage(
  project: unknown,
  range: FrameRange | null = null,
  opts: MediaUsageOptions = {},
): Map<string, MediaUsage> {
  const usage = new Map<string, MediaUsage>();
  const timeline = asRecord(project)?.timeline;
  const timelineRecord = asRecord(timeline);
  const compositions = new Map<string, unknown>(
    asArray(timelineRecord?.compositions)
      .map((composition) => [String(asRecord(composition)?.id ?? ''), composition] as const)
      .filter(([id]) => id.length > 0),
  );

  for (const item of asArray(timelineRecord?.items)) {
    const mediaItem = asRecord(item) as MediaItemLike | null;
    if (!mediaItem || !itemOverlapsRange(mediaItem, range)) continue;
    collectMediaFromItem(mediaItem, usage, opts);
    if (mediaItem.type === 'composition' && typeof mediaItem.compositionId === 'string') {
      const composition = asRecord(compositions.get(mediaItem.compositionId));
      collectMediaUsageFromItems(asArray(composition?.items), null, opts, usage);
    }
  }

  return usage;
}

export function collectMediaUsageFromTracks(
  tracks: Iterable<MediaTrackLike>,
  range: FrameRange | null = null,
  opts: MediaUsageOptions = {},
): Map<string, MediaUsage> {
  const usage = new Map<string, MediaUsage>();
  for (const track of tracks) {
    const items = (track.items ?? []).map((item) => ({
      ...item,
      trackId: item.trackId ?? track.id ?? null,
    }));
    collectMediaUsageFromItems(items, range, opts, usage);
  }
  return usage;
}

export function collectMediaUsageFromItems(
  items: Iterable<unknown>,
  range: FrameRange | null = null,
  opts: MediaUsageOptions = {},
  usage: Map<string, MediaUsage> = new Map(),
): Map<string, MediaUsage> {
  for (const item of items) {
    const mediaItem = asRecord(item) as MediaItemLike | null;
    if (!mediaItem || !itemOverlapsRange(mediaItem, range)) continue;
    collectMediaFromItem(mediaItem, usage, opts);
  }
  return usage;
}

export function normalizeRenderMediaSources(sources: RenderMediaSourcesInput): Map<string, RenderMediaSource> {
  const out = new Map<string, RenderMediaSource>();
  if (!sources) return out;

  for (const [mediaId, source] of Object.entries(sources)) {
    if (typeof source === 'string') {
      if (!source) throw new Error(`invalid media source for ${mediaId}`);
      out.set(mediaId, { url: source });
      continue;
    }
    if (!source || typeof source.url !== 'string' || source.url.length === 0) {
      throw new Error(`invalid media source for ${mediaId}`);
    }
    out.set(mediaId, source);
  }

  return out;
}

export function planRenderMediaSources(
  requiredMediaIds: Iterable<string>,
  sources: RenderMediaSourcesInput,
): RenderMediaSourcePlan {
  const normalizedSources = normalizeRenderMediaSources(sources);
  const required = [...new Set([...requiredMediaIds].filter((id) => typeof id === 'string' && id.length > 0))];
  const requiredSet = new Set(required);
  const missingMediaIds = required.filter((mediaId) => !normalizedSources.has(mediaId));
  const unusedMediaIds = [...normalizedSources.keys()].filter((mediaId) => !requiredSet.has(mediaId));

  return {
    ok: missingMediaIds.length === 0,
    requiredMediaIds: required,
    missingMediaIds,
    unusedMediaIds,
    sources: normalizedSources,
  };
}

export function assertRenderMediaSources(plan: RenderMediaSourcePlan): void {
  if (plan.ok) return;
  throw new Error(`missing media source URL for ${plan.missingMediaIds.join(', ')}`);
}

function collectMediaFromItem(
  item: MediaItemLike,
  usage: Map<string, MediaUsage>,
  opts: MediaUsageOptions = {},
): void {
  if (
    !item.mediaId ||
    !item.type ||
    !MEDIA_ITEM_TYPES.has(item.type) ||
    (opts.requireExternalSource && typeof item.src === 'string' && item.src.length > 0)
  ) {
    return;
  }

  const existing = usage.get(item.mediaId) ?? {
    mediaId: item.mediaId,
    itemCount: 0,
    items: [],
  };
  existing.itemCount += 1;
  existing.items.push({
    id: item.id,
    type: item.type,
    label: item.label ?? '',
    from: Number(item.from ?? 0),
    durationInFrames: Number(item.durationInFrames ?? 0),
    trackId: item.trackId ?? null,
  });
  usage.set(item.mediaId, existing);
}

function itemOverlapsRange(item: MediaItemLike, range: FrameRange | null): boolean {
  if (!range) return true;
  const start = Number(item.from ?? 0);
  const end = start + Number(item.durationInFrames ?? 0);
  return end > range.inFrame && start < range.outFrame;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
