/**
 * Builder API for authoring FreeCut projects programmatically.
 *
 * The builder is a thin stateful wrapper around a plain `Project`. It
 * mutates the project in place, returns the builder for chaining, and
 * returns ids for the things it creates so callers can reference them
 * later (transitions, effects, splits).
 */

import type {
  AdjustmentItem,
  AudioItem,
  GpuEffect,
  ImageItem,
  ItemEffect,
  Marker,
  MediaReference,
  Project,
  ProjectResolution,
  ShapeItem,
  TextItem,
  TimelineItem,
  Track,
  Transition,
  Transform,
  VideoItem,
} from './types.js';
import { randomIds, type IdGenerator } from './ids.js';
import { secondsToFrames } from './time.js';

export interface CreateProjectOptions {
  name: string;
  description?: string;
  width?: number;
  height?: number;
  fps?: number;
  backgroundColor?: string;
  /** Optional custom id generator — pass `deterministicIds()` for reproducible output. */
  ids?: IdGenerator;
  /** Optional clock — defaults to `Date.now`. */
  now?: () => number;
}

type ClipCore = {
  trackId: string;
  from: number;
  durationInFrames: number;
  label?: string;
  mediaId?: string;
  transform?: Transform;
};

export class ProjectBuilder {
  readonly project: Project;
  readonly mediaReferences: MediaReference[] = [];
  private readonly ids: IdGenerator;
  private readonly now: () => number;

  constructor(opts: CreateProjectOptions) {
    this.ids = opts.ids ?? randomIds;
    this.now = opts.now ?? Date.now;

    const metadata: ProjectResolution = {
      width: opts.width ?? 1920,
      height: opts.height ?? 1080,
      fps: opts.fps ?? 30,
      ...(opts.backgroundColor !== undefined && { backgroundColor: opts.backgroundColor }),
    };

    const ts = this.now();
    this.project = {
      id: this.ids('project'),
      name: opts.name,
      description: opts.description ?? '',
      createdAt: ts,
      updatedAt: ts,
      duration: 0,
      metadata,
      timeline: {
        tracks: [],
        items: [],
        transitions: [],
        markers: [],
      },
    };
  }

  // ---- project metadata --------------------------------------------------

  /** Update the `updatedAt` timestamp and recompute `duration` from clips. */
  touch(): this {
    this.project.updatedAt = this.now();
    const items = this.project.timeline?.items ?? [];
    const fps = this.project.metadata.fps;
    const endFrame = items.reduce((max, it) => Math.max(max, it.from + it.durationInFrames), 0);
    this.project.duration = endFrame / fps;
    return this;
  }

  // ---- tracks -----------------------------------------------------------

  addTrack(opts: Partial<Track> & { kind?: 'video' | 'audio' } = {}): Track {
    const tracks = this.project.timeline!.tracks;
    const minOrder = tracks.length === 0 ? 0 : Math.min(...tracks.map((t) => t.order));
    const kind = opts.kind ?? 'video';
    const track: Track = {
      id: opts.id ?? this.ids('track'),
      name: opts.name ?? (kind === 'audio' ? 'Audio' : 'Video'),
      kind,
      height: opts.height ?? 60,
      locked: opts.locked ?? false,
      visible: opts.visible ?? true,
      muted: opts.muted ?? false,
      solo: opts.solo ?? false,
      order: opts.order ?? minOrder - 1,
      ...(opts.volume !== undefined && { volume: opts.volume }),
      ...(opts.color !== undefined && { color: opts.color }),
    };
    tracks.push(track);
    return track;
  }

  /** Return an existing track id or create a new one with sensible defaults. */
  ensureTrack(kind: 'video' | 'audio' = 'video'): Track {
    const tracks = this.project.timeline!.tracks;
    const match = tracks.find((t) => (t.kind ?? 'video') === kind && !t.isGroup);
    return match ?? this.addTrack({ kind });
  }

  // ---- media references -------------------------------------------------

  /**
   * Register a media reference. The SDK output is a snapshot (metadata
   * only) — the actual file isn't bundled. The editor resolves media on
   * import by id, content hash, or filename.
   */
  addMediaReference(ref: Omit<MediaReference, 'id'> & { id?: string }): MediaReference {
    const entry: MediaReference = { ...ref, id: ref.id ?? this.ids('media') };
    this.mediaReferences.push(entry);
    return entry;
  }

  // ---- clips ------------------------------------------------------------

  addVideoClip(opts: ClipCore & {
    src?: string;
    sourceFps?: number;
    sourceDuration?: number;
    sourceStart?: number;
    sourceEnd?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    volume?: number;
  }): VideoItem {
    const item: VideoItem = {
      ...this.baseClip(opts, 'video'),
      type: 'video',
      ...pick(opts, ['src', 'sourceFps', 'sourceDuration', 'sourceStart', 'sourceEnd', 'sourceWidth', 'sourceHeight', 'volume']),
    };
    this.push(item);
    return item;
  }

  addAudioClip(opts: ClipCore & {
    src?: string;
    sourceFps?: number;
    sourceDuration?: number;
    sourceStart?: number;
    sourceEnd?: number;
    volume?: number;
  }): AudioItem {
    const item: AudioItem = {
      ...this.baseClip(opts, 'audio'),
      type: 'audio',
      ...pick(opts, ['src', 'sourceFps', 'sourceDuration', 'sourceStart', 'sourceEnd', 'volume']),
    };
    this.push(item);
    return item;
  }

  addImageClip(opts: ClipCore & {
    src?: string;
    sourceWidth?: number;
    sourceHeight?: number;
  }): ImageItem {
    const item: ImageItem = {
      ...this.baseClip(opts, 'image'),
      type: 'image',
      ...pick(opts, ['src', 'sourceWidth', 'sourceHeight']),
    };
    this.push(item);
    return item;
  }

  addTextClip(opts: ClipCore & {
    text: string;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: TextItem['fontWeight'];
    fontStyle?: TextItem['fontStyle'];
    textAlign?: TextItem['textAlign'];
    verticalAlign?: TextItem['verticalAlign'];
    backgroundColor?: string;
    stroke?: TextItem['stroke'];
    textShadow?: TextItem['textShadow'];
  }): TextItem {
    const item: TextItem = {
      ...this.baseClip(opts, 'text'),
      type: 'text',
      text: opts.text,
      color: opts.color ?? '#ffffff',
      ...pick(opts, ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign', 'verticalAlign', 'backgroundColor', 'stroke', 'textShadow']),
    };
    this.push(item);
    return item;
  }

  addShapeClip(opts: ClipCore & {
    shapeType: ShapeItem['shapeType'];
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    cornerRadius?: number;
  }): ShapeItem {
    const item: ShapeItem = {
      ...this.baseClip(opts, 'shape'),
      type: 'shape',
      shapeType: opts.shapeType,
      fillColor: opts.fillColor ?? '#ffffff',
      ...pick(opts, ['strokeColor', 'strokeWidth', 'cornerRadius']),
    };
    this.push(item);
    return item;
  }

  addAdjustmentLayer(opts: ClipCore & { effectOpacity?: number }): AdjustmentItem {
    const item: AdjustmentItem = {
      ...this.baseClip(opts, 'adjustment'),
      type: 'adjustment',
      ...pick(opts, ['effectOpacity']),
    };
    this.push(item);
    return item;
  }

  // ---- modifications ----------------------------------------------------

  /** Apply a GPU effect to an existing clip. Returns the created ItemEffect id. */
  applyGpuEffect(itemId: string, effect: GpuEffect, enabled = true): string {
    const item = this.getItem(itemId);
    const entry: ItemEffect = {
      id: this.ids('effect'),
      enabled,
      effect,
    };
    item.effects = [...(item.effects ?? []), entry];
    return entry.id;
  }

  setTransform(itemId: string, transform: Transform): void {
    const item = this.getItem(itemId);
    item.transform = { ...item.transform, ...transform };
  }

  /**
   * Split a clip at an absolute project frame. Returns the right-side clip
   * (the left retains the original id).
   */
  split(itemId: string, atFrame: number): TimelineItem {
    const item = this.getItem(itemId);
    const offset = atFrame - item.from;
    if (offset <= 0 || offset >= item.durationInFrames) {
      throw new RangeError(
        `split frame ${atFrame} must be strictly inside clip [${item.from}, ${item.from + item.durationInFrames})`,
      );
    }
    const right: TimelineItem = {
      ...item,
      id: this.ids('item'),
      from: atFrame,
      durationInFrames: item.durationInFrames - offset,
    };
    // Carry source-frame math forward if present.
    if (item.sourceStart !== undefined) {
      const sourceFps = item.sourceFps ?? this.project.metadata.fps;
      const sourceOffset = Math.round((offset / this.project.metadata.fps) * sourceFps);
      right.sourceStart = item.sourceStart + sourceOffset;
    }
    item.durationInFrames = offset;
    if (item.sourceEnd !== undefined) {
      const sourceFps = item.sourceFps ?? this.project.metadata.fps;
      const sourceOffset = Math.round((offset / this.project.metadata.fps) * sourceFps);
      item.sourceEnd = (item.sourceStart ?? 0) + sourceOffset;
    }
    this.project.timeline!.items.push(right);
    return right;
  }

  // ---- transitions ------------------------------------------------------

  addTransition(opts: {
    leftClipId: string;
    rightClipId: string;
    durationInFrames: number;
    presetId?: string;
    alignment?: number;
    properties?: Record<string, unknown>;
  }): Transition {
    const left = this.getItem(opts.leftClipId);
    const right = this.getItem(opts.rightClipId);
    if (left.trackId !== right.trackId) {
      throw new Error('transition clips must be on the same track');
    }
    const t: Transition = {
      id: this.ids('transition'),
      type: 'crossfade',
      leftClipId: opts.leftClipId,
      rightClipId: opts.rightClipId,
      trackId: left.trackId,
      durationInFrames: opts.durationInFrames,
      ...(opts.presetId !== undefined && { presetId: opts.presetId }),
      ...(opts.alignment !== undefined && { alignment: opts.alignment }),
      ...(opts.properties !== undefined && { properties: opts.properties }),
    };
    this.project.timeline!.transitions!.push(t);
    return t;
  }

  // ---- markers ----------------------------------------------------------

  setInOutPoints(inPoint: number | null, outPoint: number | null): this {
    const sanitized = sanitizeInOutPoints(inPoint, outPoint);
    this.project.timeline!.inPoint = sanitized.inPoint;
    this.project.timeline!.outPoint = sanitized.outPoint;
    return this;
  }

  setRenderRange(opts: { startFrame?: number; durationInFrames?: number; endFrame?: number }): this {
    const start = opts.startFrame ?? 0;
    const end = opts.endFrame ?? (
      opts.durationInFrames === undefined ? undefined : start + opts.durationInFrames
    );
    if (end === undefined) {
      throw new Error('setRenderRange requires durationInFrames or endFrame');
    }
    return this.setInOutPoints(start, end);
  }

  clearInOutPoints(): this {
    this.project.timeline!.inPoint = undefined;
    this.project.timeline!.outPoint = undefined;
    return this;
  }

  addMarker(opts: { frame: number; label?: string; color?: string }): Marker {
    const m: Marker = {
      id: this.ids('marker'),
      frame: opts.frame,
      color: opts.color ?? '#ff4444',
      ...(opts.label !== undefined && { label: opts.label }),
    };
    this.project.timeline!.markers!.push(m);
    return m;
  }

  // ---- helpers ----------------------------------------------------------

  secondsToFrames(seconds: number): number {
    return secondsToFrames(seconds, this.project.metadata.fps);
  }

  /** Frame at which the next appended clip on `trackId` should start. */
  endOfTrack(trackId: string): number {
    const items = this.project.timeline!.items.filter((it) => it.trackId === trackId);
    return items.reduce((max, it) => Math.max(max, it.from + it.durationInFrames), 0);
  }

  // ---- internals --------------------------------------------------------

  private baseClip(opts: ClipCore, kind: string): {
    id: string;
    trackId: string;
    from: number;
    durationInFrames: number;
    label: string;
    mediaId?: string;
    transform?: Transform;
  } {
    if (opts.durationInFrames <= 0) {
      throw new RangeError(`durationInFrames must be positive, got ${opts.durationInFrames}`);
    }
    if (opts.from < 0) {
      throw new RangeError(`from must be non-negative, got ${opts.from}`);
    }
    return {
      id: this.ids('item'),
      trackId: opts.trackId,
      from: opts.from,
      durationInFrames: opts.durationInFrames,
      label: opts.label ?? kind,
      ...(opts.mediaId !== undefined && { mediaId: opts.mediaId }),
      ...(opts.transform !== undefined && { transform: opts.transform }),
    };
  }

  private push(item: TimelineItem): void {
    this.project.timeline!.items.push(item);
  }

  private getItem(id: string): TimelineItem {
    const item = this.project.timeline!.items.find((it) => it.id === id);
    if (!item) throw new Error(`no timeline item with id ${id}`);
    return item;
  }
}

export function createProject(opts: CreateProjectOptions): ProjectBuilder {
  return new ProjectBuilder(opts);
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function sanitizeInOutPoints(inPoint: number | null, outPoint: number | null): { inPoint?: number; outPoint?: number } {
  if (inPoint === null && outPoint === null) return {};
  if (!Number.isInteger(inPoint) || inPoint < 0) {
    throw new RangeError(`inPoint must be a non-negative integer or null, got ${inPoint}`);
  }
  if (!Number.isInteger(outPoint) || outPoint <= 0) {
    throw new RangeError(`outPoint must be a positive integer or null, got ${outPoint}`);
  }
  if (inPoint >= outPoint) {
    throw new RangeError(`inPoint must be before outPoint, got ${inPoint} >= ${outPoint}`);
  }
  return { inPoint, outPoint };
}
