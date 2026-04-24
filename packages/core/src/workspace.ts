// @ts-nocheck
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { collectProjectMediaUsage } from './media-plan.js';
import { planProjectRender } from './render-plan.js';

const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
]);

export async function listWorkspaceProjects(workspace, opts = {}) {
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

    const links = await readJsonIfExists(join(projectDir, 'media-links.json'), read);
    projects.push({
      id: project.id ?? id,
      name: project.name ?? id,
      description: project.description ?? '',
      width: project.metadata?.width ?? 0,
      height: project.metadata?.height ?? 0,
      fps: project.metadata?.fps ?? 0,
      duration: Number(project.duration ?? 0),
      updatedAt: Number(project.updatedAt ?? 0),
      createdAt: Number(project.createdAt ?? 0),
      schemaVersion: project.schemaVersion ?? null,
      trackCount: project.timeline?.tracks?.length ?? 0,
      itemCount: project.timeline?.items?.length ?? 0,
      mediaCount: links?.mediaIds?.length ?? 0,
      trashed: Boolean(trashed),
    });
  }

  return projects.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export async function inspectWorkspaceProject(workspace, selector, opts = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const project = await readWorkspaceProject(workspace, selector, { readFile: read, readdir: list });
  const projectDir = join(workspace, 'projects', project.id);
  const links = await readJsonIfExists(join(projectDir, 'media-links.json'), read);
  const timeline = project.timeline ?? {};
  const tracks = timeline.tracks ?? [];
  const items = timeline.items ?? [];
  const transitions = timeline.transitions ?? [];
  const markers = timeline.markers ?? [];
  const keyframes = timeline.keyframes ?? [];
  const compositions = timeline.compositions ?? [];
  const mediaIds = collectAllProjectMediaIds(project);
  const linkedMediaIds = links?.mediaIds?.map((entry) => entry.id).filter(Boolean) ?? [];

  return {
    workspace,
    project: {
      id: project.id,
      name: project.name,
      description: project.description ?? '',
      duration: Number(project.duration ?? 0),
      schemaVersion: project.schemaVersion ?? null,
      createdAt: Number(project.createdAt ?? 0),
      updatedAt: Number(project.updatedAt ?? 0),
      resolution: {
        width: project.metadata?.width ?? 0,
        height: project.metadata?.height ?? 0,
        fps: project.metadata?.fps ?? 0,
        backgroundColor: project.metadata?.backgroundColor,
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
      id: track.id,
      name: track.name,
      kind: track.kind ?? null,
      order: track.order ?? 0,
      visible: track.visible ?? true,
      muted: track.muted ?? false,
      locked: track.locked ?? false,
      itemCount: items.filter((item) => item.trackId === track.id).length,
    })),
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      trackId: item.trackId,
      from: Number(item.from ?? 0),
      durationInFrames: Number(item.durationInFrames ?? 0),
      label: item.label ?? '',
      mediaId: item.mediaId ?? null,
    })),
    transitions,
    markers,
    compositions: compositions.map((composition) => ({
      id: composition.id,
      name: composition.name,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
      itemCount: composition.items?.length ?? 0,
      trackCount: composition.tracks?.length ?? 0,
    })),
    media: {
      linkedIds: linkedMediaIds,
      referencedIds: mediaIds,
      missingLinks: mediaIds.filter((id) => !linkedMediaIds.includes(id)),
      orphanLinks: linkedMediaIds.filter((id) => !mediaIds.includes(id)),
    },
  };
}

export async function inspectWorkspaceMedia(workspace, selector, opts = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const statFile = opts.stat ?? stat;
  const project = await readWorkspaceProject(workspace, selector, { readFile: read, readdir: list });
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
      fileName: metadata?.fileName ?? (sourceFile ? basename(sourceFile) : null),
      mimeType: metadata?.mimeType ?? (sourceFile ? mimeTypeFromFileName(sourceFile) : null),
      metadataExists: Boolean(metadata),
      metadataFile: metadata ? metadataPath : null,
      sourceExists: Boolean(sourceFile),
      sourceFile: sourceFile ? resolve(sourceFile) : null,
      sourceFileSize: sourceStats?.size ?? null,
      expectedFileSize: metadata?.fileSize ?? null,
      duration: metadata?.duration ?? null,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      fps: metadata?.fps ?? null,
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
      id: project.id,
      name: project.name,
      width: project.metadata?.width ?? 0,
      height: project.metadata?.height ?? 0,
      fps: project.metadata?.fps ?? 0,
      itemCount: project.timeline?.items?.length ?? 0,
    },
    range: rangeToSeconds(project, range),
    media,
    missingMedia: missing,
  };
}

export async function loadWorkspaceRenderSource(workspace, selector, renderConfig = {}, deps = {}) {
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
  const mediaSources = {};
  const missingSources = [];
  const requiredMedia = [];

  for (const mediaId of mediaIds) {
    const mediaDir = join(workspace, 'media', mediaId);
    const metadata = await readJsonIfExists(join(mediaDir, 'metadata.json'), read);
    const filePath = await findWorkspaceMediaSource(mediaDir, { readdir: list });
    const usage = mediaUsage.get(mediaId);
    if (!filePath) {
      const missing = {
        mediaId,
        fileName: metadata?.fileName ?? null,
        mimeType: metadata?.mimeType ?? null,
        fileSize: metadata?.fileSize ?? null,
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
      fileName: metadata?.fileName ?? basename(filePath),
      mimeType: metadata?.mimeType ?? mimeTypeFromFileName(filePath),
      fileSize: metadata?.fileSize ?? null,
      sourceFile: resolve(filePath),
      sourceExists: true,
      itemCount: usage?.itemCount ?? 0,
    };
    requiredMedia.push(mediaPlan);
    mediaSources[mediaId] = {
      filePath,
      mimeType: metadata?.mimeType,
      keyframeTimestamps: Array.isArray(metadata?.keyframeTimestamps)
        ? metadata.keyframeTimestamps
        : undefined,
    };
  }

  return { project, mediaSources, requiredMedia, missingSources, effectiveRange, workspace };
}

export async function readWorkspaceProject(workspace, selector, opts = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  if (selector.projectId) {
    return readJson(join(workspace, 'projects', selector.projectId, 'project.json'), read);
  }

  const index = await readJsonIfExists(join(workspace, 'index.json'), read);
  const indexed = index?.projects?.find((entry) =>
    entry.name === selector.project ||
    entry.id === selector.project ||
    entry.name?.toLowerCase?.() === selector.project.toLowerCase()
  );
  if (indexed) {
    return readJson(join(workspace, 'projects', indexed.id, 'project.json'), read);
  }

  const ids = await listProjectIds(workspace, read, list);
  const available = [];
  for (const id of ids) {
    const project = await readJsonIfExists(join(workspace, 'projects', id, 'project.json'), read);
    if (!project) continue;
    available.push(project.name ?? id);
    if (project.id === selector.project || project.name === selector.project) return project;
    if (project.name?.toLowerCase?.() === selector.project.toLowerCase()) return project;
  }

  throw new Error(
    `no workspace project matched ${JSON.stringify(selector.project)}; available projects: ${available.join(', ')}`,
  );
}

export function buildRange(values) {
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

export async function findWorkspaceMediaSource(mediaDir, opts = {}) {
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

export function mimeTypeFromFileName(file) {
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

function rangeToSeconds(project, range) {
  return range
    ? {
        inFrame: range.inFrame,
        outFrame: range.outFrame,
        startSeconds: project.metadata?.fps > 0 ? range.inFrame / project.metadata.fps : null,
        durationSeconds: project.metadata?.fps > 0 ? (range.outFrame - range.inFrame) / project.metadata.fps : null,
      }
    : null;
}

async function listProjectIds(workspace, read, list) {
  const index = await readJsonIfExists(join(workspace, 'index.json'), read);
  const indexedIds = index?.projects
    ?.map((entry) => entry?.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
  if (indexedIds?.length) return [...new Set(indexedIds)];

  const entries = await list(join(workspace, 'projects'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function collectAllProjectMediaIds(project) {
  return [...collectProjectMediaUsage(project, null).keys()].sort();
}

function countKeyframes(keyframes) {
  return keyframes.reduce((sum, item) => (
    sum + (item.properties ?? []).reduce((propertySum, property) => (
      propertySum + (property.keyframes?.length ?? 0)
    ), 0)
  ), 0);
}

function frameOpt(raw, label, allowZero = true) {
  const n = Number.parseInt(raw, 10);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, got ${raw}`);
  }
  return n;
}

function nonNegativeNumberOpt(raw, label) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`${label} must be a non-negative number, got ${raw}`);
  }
  return n;
}

function positiveNumberOpt(raw, label) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${label} must be a positive number, got ${raw}`);
  }
  return n;
}

async function statIfExists(file, statFile) {
  try {
    return await statFile(file);
  } catch {
    return null;
  }
}

async function readJsonIfExists(file, read) {
  try {
    return await readJson(file, read);
  } catch {
    return null;
  }
}

async function readJson(file, read) {
  return JSON.parse(await read(file, 'utf8'));
}
