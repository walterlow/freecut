import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { collectProjectMediaUsage } from './media-plan.js';
import { planProjectRender } from './render-plan.js';
import type { RenderRangeInput } from './range.js';

type ReadFileFn = (file: string, encoding: 'utf8') => Promise<string>;
type ReaddirFn = (path: string, opts: { withFileTypes: true }) => Promise<Dirent[]>;
type StatFn = (file: string) => Promise<{ isFile?: () => boolean; size: number }>;
type JsonRecord = Record<string, unknown>;

interface WorkspaceFsDeps {
  readFile?: ReadFileFn;
  readdir?: ReaddirFn;
  stat?: StatFn;
}

interface ListWorkspaceProjectsOptions extends WorkspaceFsDeps {
  includeTrashed?: boolean;
}

type WorkspaceProjectSelector =
  | { project: string; projectId?: string }
  | { project?: string; projectId: string };

interface WorkspaceRenderOptions extends WorkspaceFsDeps {
  range?: RenderRangeInput | null;
  renderWholeProject?: boolean;
}

interface WorkspaceRequiredMedia {
  mediaId: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  sourceFile: string | null;
  sourceExists: boolean;
  itemCount: number;
}

interface WorkspaceMediaSource {
  filePath: string;
  mimeType?: string;
  keyframeTimestamps?: number[];
}

const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
]);

export async function listWorkspaceProjects(workspace: string, opts: ListWorkspaceProjectsOptions = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const ids = await listProjectIds(workspace, read, list);
  const projects = [];

  for (const id of ids) {
    const projectDir = join(workspace, 'projects', id);
    const trashed = await readJsonIfExists(join(projectDir, '.freecut-trashed.json'), read);
    if (trashed && !opts.includeTrashed) continue;

    const project = await readJsonIfExists(join(projectDir, 'project.json'), read);
    if (!project) continue;
    const metadata = asRecord(project.metadata);
    const timeline = asRecord(project.timeline);

    const links = await readJsonIfExists(join(projectDir, 'media-links.json'), read);
    const mediaLinks = recordsFromArray(links?.mediaIds);
    projects.push({
      id: stringValue(project.id) ?? id,
      name: stringValue(project.name) ?? id,
      description: stringValue(project.description) ?? '',
      width: numberValue(metadata?.width) ?? 0,
      height: numberValue(metadata?.height) ?? 0,
      fps: numberValue(metadata?.fps) ?? 0,
      duration: Number(project.duration ?? 0),
      updatedAt: Number(project.updatedAt ?? 0),
      createdAt: Number(project.createdAt ?? 0),
      schemaVersion: numberValue(project.schemaVersion),
      trackCount: arrayLength(timeline?.tracks),
      itemCount: arrayLength(timeline?.items),
      mediaCount: mediaLinks.length,
      trashed: Boolean(trashed),
    });
  }

  return projects.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export async function inspectWorkspaceProject(workspace: string, selector: WorkspaceProjectSelector, opts: WorkspaceFsDeps = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const project = await readWorkspaceProject(workspace, selector, { readFile: read, readdir: list });
  const projectId = stringValue(project.id) ?? '';
  const projectDir = join(workspace, 'projects', projectId);
  const links = await readJsonIfExists(join(projectDir, 'media-links.json'), read);
  const metadata = asRecord(project.metadata);
  const timeline = asRecord(project.timeline) ?? {};
  const tracks = recordsFromArray(timeline.tracks);
  const items = recordsFromArray(timeline.items);
  const transitions = arrayFrom(timeline.transitions);
  const markers = arrayFrom(timeline.markers);
  const keyframes = recordsFromArray(timeline.keyframes);
  const compositions = recordsFromArray(timeline.compositions);
  const mediaIds = collectAllProjectMediaIds(project);
  const linkedMediaIds = recordsFromArray(links?.mediaIds)
    .map((entry) => stringValue(entry.id))
    .filter((id): id is string => Boolean(id));

  return {
    workspace,
    project: {
      id: projectId,
      name: stringValue(project.name) ?? projectId,
      description: stringValue(project.description) ?? '',
      duration: Number(project.duration ?? 0),
      schemaVersion: numberValue(project.schemaVersion),
      createdAt: Number(project.createdAt ?? 0),
      updatedAt: Number(project.updatedAt ?? 0),
      resolution: {
        width: numberValue(metadata?.width) ?? 0,
        height: numberValue(metadata?.height) ?? 0,
        fps: numberValue(metadata?.fps) ?? 0,
        backgroundColor: stringValue(metadata?.backgroundColor),
      },
    },
    counts: {
      tracks: tracks.length,
      items: items.length,
      transitions: transitions.length,
      markers: markers.length,
      keyframeItems: keyframes.length,
      keyframes: countKeyframes(keyframes),
      compositions: compositions.length,
      linkedMedia: linkedMediaIds.length,
      referencedMedia: mediaIds.length,
    },
    tracks: tracks.map((track) => ({
      id: stringValue(track.id) ?? '',
      name: stringValue(track.name) ?? '',
      kind: stringValue(track.kind) ?? null,
      order: numberValue(track.order) ?? 0,
      visible: booleanValue(track.visible) ?? true,
      muted: booleanValue(track.muted) ?? false,
      locked: booleanValue(track.locked) ?? false,
      itemCount: items.filter((item) => item.trackId === track.id).length,
    })),
    items: items.map((item) => ({
      id: stringValue(item.id) ?? '',
      type: stringValue(item.type) ?? '',
      trackId: stringValue(item.trackId) ?? '',
      from: Number(item.from ?? 0),
      durationInFrames: Number(item.durationInFrames ?? 0),
      label: stringValue(item.label) ?? '',
      mediaId: stringValue(item.mediaId) ?? null,
    })),
    transitions,
    markers,
    compositions: compositions.map((composition) => ({
      id: stringValue(composition.id) ?? '',
      name: stringValue(composition.name) ?? '',
      width: numberValue(composition.width) ?? 0,
      height: numberValue(composition.height) ?? 0,
      fps: numberValue(composition.fps) ?? 0,
      durationInFrames: numberValue(composition.durationInFrames) ?? 0,
      itemCount: arrayLength(composition.items),
      trackCount: arrayLength(composition.tracks),
    })),
    media: {
      linkedIds: linkedMediaIds,
      referencedIds: mediaIds,
      missingLinks: mediaIds.filter((id: string) => !linkedMediaIds.includes(id)),
      orphanLinks: linkedMediaIds.filter((id: string) => !mediaIds.includes(id)),
    },
  };
}

export async function inspectWorkspaceMedia(workspace: string, selector: WorkspaceProjectSelector, opts: WorkspaceRenderOptions = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const statFile = opts.stat ?? stat;
  const project = await readWorkspaceProject(workspace, selector, { readFile: read, readdir: list });
  const metadata = asRecord(project.metadata);
  const timeline = asRecord(project.timeline);
  const renderPlan = planProjectRender(project, {
    range: opts.range,
    renderWholeProject: opts.renderWholeProject,
  });
  const range = renderPlan.effectiveRange;
  const usages = renderPlan.mediaUsage;
  const media = [];

  for (const usage of usages.values()) {
    const mediaDir = join(workspace, 'media', usage.mediaId);
    const metadataPath = join(mediaDir, 'metadata.json');
    const metadata = await readJsonIfExists(metadataPath, read);
    const sourceFile = await findWorkspaceMediaSource(mediaDir, { readdir: list });
    const sourceStats = sourceFile ? await statIfExists(sourceFile, statFile) : null;
    media.push({
      mediaId: usage.mediaId,
      fileName: stringValue(metadata?.fileName) ?? (sourceFile ? basename(sourceFile) : null),
      mimeType: stringValue(metadata?.mimeType) ?? (sourceFile ? mimeTypeFromFileName(sourceFile) : null),
      metadataExists: Boolean(metadata),
      metadataFile: metadata ? metadataPath : null,
      sourceExists: Boolean(sourceFile),
      sourceFile: sourceFile ? resolve(sourceFile) : null,
      sourceFileSize: sourceStats?.size ?? null,
      expectedFileSize: numberValue(metadata?.fileSize),
      duration: numberValue(metadata?.duration),
      width: numberValue(metadata?.width),
      height: numberValue(metadata?.height),
      fps: numberValue(metadata?.fps),
      itemCount: usage.itemCount,
      items: usage.items,
      ready: Boolean(metadata && sourceFile),
    });
  }

  media.sort((a, b) => Number(a.ready) - Number(b.ready) || a.mediaId.localeCompare(b.mediaId));
  const missing = media.filter((entry) => !entry.ready);
  return {
    ok: missing.length === 0,
    workspace,
    project: {
      id: stringValue(project.id) ?? '',
      name: stringValue(project.name) ?? '',
      width: numberValue(metadata?.width) ?? 0,
      height: numberValue(metadata?.height) ?? 0,
      fps: numberValue(metadata?.fps) ?? 0,
      itemCount: arrayLength(timeline?.items),
    },
    range: rangeToSeconds(project, range),
    media,
    missingMedia: missing,
  };
}

export async function loadWorkspaceRenderSource(
  workspace: string,
  selector: WorkspaceProjectSelector,
  renderConfig: WorkspaceRenderOptions = {},
  deps: WorkspaceFsDeps = {},
) {
  const read = deps.readFile ?? readFile;
  const list = deps.readdir ?? readdir;
  const project = await readWorkspaceProject(workspace, selector, { readFile: read, readdir: list });
  const renderPlan = planProjectRender(project, {
    range: renderConfig.range,
    renderWholeProject: renderConfig.renderWholeProject,
  });
  const effectiveRange = renderPlan.effectiveRange;
  const mediaUsage = renderPlan.mediaUsage;
  const mediaIds = [...mediaUsage.keys()];
  const mediaSources: Record<string, WorkspaceMediaSource> = {};
  const missingSources: WorkspaceRequiredMedia[] = [];
  const requiredMedia: WorkspaceRequiredMedia[] = [];

  for (const mediaId of mediaIds) {
    const mediaDir = join(workspace, 'media', mediaId);
    const metadata = await readJsonIfExists(join(mediaDir, 'metadata.json'), read);
    const filePath = await findWorkspaceMediaSource(mediaDir, { readdir: list });
    const usage = mediaUsage.get(mediaId);
    if (!filePath) {
      const missing: WorkspaceRequiredMedia = {
        mediaId,
        fileName: stringValue(metadata?.fileName) ?? null,
        mimeType: stringValue(metadata?.mimeType) ?? null,
        fileSize: numberValue(metadata?.fileSize),
        sourceFile: null,
        sourceExists: false,
        itemCount: usage?.itemCount ?? 0,
      };
      missingSources.push(missing);
      requiredMedia.push(missing);
      continue;
    }

    const mediaPlan = {
      mediaId,
      fileName: stringValue(metadata?.fileName) ?? basename(filePath),
      mimeType: stringValue(metadata?.mimeType) ?? mimeTypeFromFileName(filePath),
      fileSize: numberValue(metadata?.fileSize),
      sourceFile: resolve(filePath),
      sourceExists: true,
      itemCount: usage?.itemCount ?? 0,
    };
    requiredMedia.push(mediaPlan);
    mediaSources[mediaId] = {
      filePath,
      mimeType: stringValue(metadata?.mimeType),
      keyframeTimestamps: Array.isArray(metadata?.keyframeTimestamps)
        ? metadata.keyframeTimestamps.filter((timestamp): timestamp is number => typeof timestamp === 'number')
        : undefined,
    };
  }

  return { project, mediaSources, requiredMedia, missingSources, effectiveRange, workspace };
}

export async function readWorkspaceProject(workspace: string, selector: WorkspaceProjectSelector, opts: WorkspaceFsDeps = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  if (selector.projectId) {
    return readJson(join(workspace, 'projects', selector.projectId, 'project.json'), read);
  }
  const projectSelector = selector.project;
  if (!projectSelector) {
    throw new Error('workspace project selector requires project or projectId');
  }

  const index = await readJsonIfExists(join(workspace, 'index.json'), read);
  const indexed = recordsFromArray(index?.projects).find((entry) =>
    entry.name === projectSelector ||
    entry.id === projectSelector ||
    stringValue(entry.name)?.toLowerCase() === projectSelector.toLowerCase()
  );
  if (indexed) {
    const indexedId = stringValue(indexed.id);
    if (indexedId) return readJson(join(workspace, 'projects', indexedId, 'project.json'), read);
  }

  const ids = await listProjectIds(workspace, read, list);
  const available: string[] = [];
  for (const id of ids) {
    const project = await readJsonIfExists(join(workspace, 'projects', id, 'project.json'), read);
    if (!project) continue;
    const name = stringValue(project.name);
    available.push(name ?? id);
    if (project.id === projectSelector || project.name === projectSelector) return project;
    if (name?.toLowerCase() === projectSelector.toLowerCase()) return project;
  }

  throw new Error(
    `no workspace project matched ${JSON.stringify(projectSelector)}; available projects: ${available.join(', ')}`,
  );
}

export function buildRange(values: Record<string, unknown>) {
  const hasSeconds = values.start !== undefined || values.end !== undefined || values.duration !== undefined;
  const hasFrames = values['in-frame'] !== undefined || values['out-frame'] !== undefined;
  if (!hasSeconds && !hasFrames) return null;
  if (values['render-whole-project']) {
    throw new Error('range flags cannot be used with --render-whole-project');
  }
  if (hasSeconds && hasFrames) {
    throw new Error('use either seconds range flags (--start/--end/--duration) or frame flags (--in-frame/--out-frame), not both');
  }
  if (hasFrames) {
    if (values['in-frame'] === undefined || values['out-frame'] === undefined) {
      throw new Error('--in-frame and --out-frame must be set together');
    }
    const inFrame = frameOpt(values['in-frame'], '--in-frame');
    const outFrame = frameOpt(values['out-frame'], '--out-frame', false);
    if (inFrame >= outFrame) throw new Error('--in-frame must be before --out-frame');
    return { inFrame, outFrame };
  }
  const startSeconds = values.start === undefined ? 0 : nonNegativeNumberOpt(values.start, '--start');
  if (values.end !== undefined && values.duration !== undefined) {
    throw new Error('use --end or --duration, not both');
  }
  if (values.end !== undefined) {
    const endSeconds = positiveNumberOpt(values.end, '--end');
    if (startSeconds >= endSeconds) throw new Error('--start must be before --end');
    return { startSeconds, endSeconds };
  }
  if (values.duration !== undefined) {
    const durationSeconds = positiveNumberOpt(values.duration, '--duration');
    return { startSeconds, durationSeconds };
  }
  throw new Error('range requires --duration or --end when --start is used');
}

export async function findWorkspaceMediaSource(mediaDir: string, opts: WorkspaceFsDeps = {}) {
  const list = opts.readdir ?? readdir;
  let entries;
  try {
    entries = await list(mediaDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (NON_SOURCE_NAMES.has(entry.name)) continue;
    return join(mediaDir, entry.name);
  }
  return null;
}

export function mimeTypeFromFileName(file: string): string {
  const lower = basename(file).toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function rangeToSeconds(project: JsonRecord, range: { inFrame: number; outFrame: number } | null) {
  const metadata = asRecord(project.metadata);
  const fps = numberValue(metadata?.fps) ?? 0;
  return range
    ? {
        inFrame: range.inFrame,
        outFrame: range.outFrame,
        startSeconds: fps > 0 ? range.inFrame / fps : null,
        durationSeconds: fps > 0 ? (range.outFrame - range.inFrame) / fps : null,
      }
    : null;
}

async function listProjectIds(workspace: string, read: ReadFileFn, list: ReaddirFn): Promise<string[]> {
  const index = await readJsonIfExists(join(workspace, 'index.json'), read);
  const indexedIds = recordsFromArray(index?.projects)
    .map((entry) => entry.id)
    .filter((id: unknown) => typeof id === 'string' && id.length > 0);
  if (indexedIds?.length) return [...new Set(indexedIds)] as string[];

  const entries = await list(join(workspace, 'projects'), { withFileTypes: true });
  return entries
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => entry.name);
}

function collectAllProjectMediaIds(project: unknown): string[] {
  return [...collectProjectMediaUsage(project, null).keys()].sort();
}

function countKeyframes(keyframes: JsonRecord[]): number {
  return keyframes.reduce((sum: number, item: JsonRecord) => (
    sum + recordsFromArray(item.properties).reduce((propertySum: number, property: JsonRecord) => (
      propertySum + arrayLength(property.keyframes)
    ), 0)
  ), 0);
}

function frameOpt(raw: unknown, label: string, allowZero = true): number {
  const n = Number.parseInt(String(raw), 10);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, got ${raw}`);
  }
  return n;
}

function nonNegativeNumberOpt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`${label} must be a non-negative number, got ${raw}`);
  }
  return n;
}

function positiveNumberOpt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${label} must be a positive number, got ${raw}`);
  }
  return n;
}

async function statIfExists(file: string, statFile: StatFn): Promise<{ isFile?: () => boolean; size: number } | null> {
  try {
    return await statFile(file);
  } catch {
    return null;
  }
}

async function readJsonIfExists(file: string, read: ReadFileFn): Promise<JsonRecord | null> {
  try {
    return await readJson(file, read);
  } catch {
    return null;
  }
}

async function readJson(file: string, read: ReadFileFn): Promise<JsonRecord> {
  return JSON.parse(await read(file, 'utf8'));
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordsFromArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is JsonRecord => entry !== null) : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
