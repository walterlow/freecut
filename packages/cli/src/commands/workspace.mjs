import { parseArgs } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const options = {
  json: { type: 'boolean', default: false },
  'include-trashed': { type: 'boolean', default: false },
  project: { type: 'string' },
  'project-id': { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  duration: { type: 'string' },
  'in-frame': { type: 'string' },
  'out-frame': { type: 'string' },
  'render-whole-project': { type: 'boolean', default: false },
};

export async function runWorkspace(argv, { stdout }, deps = {}) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'projects' && subcommand !== 'list' && subcommand !== 'media') {
    throw workspaceUsage();
  }

  const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true });
  const workspace = positionals[0];
  if (!workspace) {
    throw workspaceUsage();
  }

  if (subcommand === 'media') {
    const selector = {
      project: values.project,
      projectId: values['project-id'],
    };
    if (!selector.project && !selector.projectId) {
      throw new Error('usage: freecut workspace media <dir> --project-id <id> [--start S --duration S] [--json]');
    }
    const range = buildRange(values);
    const report = await inspectWorkspaceMedia(resolve(workspace), selector, {
      range,
      renderWholeProject: values['render-whole-project'],
      readFile: deps.readFile,
      readdir: deps.readdir,
      stat: deps.stat,
    });
    if (values.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    writeMediaReport(stdout, report);
    return;
  }

  const projects = await listWorkspaceProjects(resolve(workspace), {
    includeTrashed: values['include-trashed'],
    readFile: deps.readFile,
    readdir: deps.readdir,
  });

  if (values.json) {
    stdout.write(`${JSON.stringify({ workspace: resolve(workspace), projects }, null, 2)}\n`);
    return;
  }

  if (projects.length === 0) {
    stdout.write(`no projects found in ${resolve(workspace)}\n`);
    return;
  }

  stdout.write(`projects in ${resolve(workspace)}\n`);
  for (const project of projects) {
    const updated = project.updatedAt ? new Date(project.updatedAt).toISOString() : 'unknown';
    stdout.write(
      `${project.id}\t${project.name}\t${project.width}x${project.height}@${project.fps}fps\t` +
      `${project.duration.toFixed(2)}s\t${project.itemCount} item(s)\tupdated ${updated}\n`,
    );
  }
}

function workspaceUsage() {
  return new Error(
    'usage: freecut workspace projects <dir> [--json] [--include-trashed]\n' +
    '   or: freecut workspace media <dir> --project-id <id> [--start S --duration S] [--json]',
  );
}

async function listWorkspaceProjects(workspace, opts = {}) {
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

async function inspectWorkspaceMedia(workspace, selector, opts = {}) {
  const read = opts.readFile ?? readFile;
  const list = opts.readdir ?? readdir;
  const statFile = opts.stat ?? stat;
  const project = await readWorkspaceProject(workspace, selector, read, list);
  const range = resolveProjectRenderRange(project, opts.range, opts.renderWholeProject);
  const usages = collectProjectMediaUsage(project, range);
  const media = [];

  for (const usage of usages.values()) {
    const mediaDir = join(workspace, 'media', usage.mediaId);
    const metadataPath = join(mediaDir, 'metadata.json');
    const metadata = await readJsonIfExists(metadataPath, read);
    const sourceFile = await findWorkspaceMediaSource(mediaDir, list);
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
      itemCount: usage.items.length,
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
    range: range
      ? {
          inFrame: range.inFrame,
          outFrame: range.outFrame,
          startSeconds: project.metadata?.fps > 0 ? range.inFrame / project.metadata.fps : null,
          durationSeconds: project.metadata?.fps > 0 ? (range.outFrame - range.inFrame) / project.metadata.fps : null,
        }
      : null,
    media,
    missingMedia: missing,
  };
}

function writeMediaReport(stdout, report) {
  stdout.write(`${report.ok ? 'ok' : 'missing media'}: workspace media\n`);
  stdout.write(`project ${report.project.id} (${report.project.name}) ${report.project.width}x${report.project.height}@${report.project.fps}fps\n`);
  if (report.range) {
    stdout.write(`range ${report.range.inFrame}-${report.range.outFrame} (${report.range.durationSeconds?.toFixed(2)}s)\n`);
  } else {
    stdout.write('range whole project\n');
  }
  stdout.write(`required media ${report.media.length}, missing ${report.missingMedia.length}\n`);
  for (const entry of report.media) {
    stdout.write(
      `${entry.ready ? 'ok' : 'missing'}\t${entry.mediaId}\t` +
      `${entry.fileName ?? '(unknown)'}\t${entry.itemCount} item(s)\t` +
      `${entry.sourceFile ?? '(no source mirror)'}\n`,
    );
  }
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

async function readWorkspaceProject(workspace, selector, read, list) {
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

function collectProjectMediaUsage(project, range) {
  const usage = new Map();
  const compositions = new Map((project.timeline?.compositions ?? []).map((composition) => [
    composition.id,
    composition,
  ]));

  for (const item of project.timeline?.items ?? []) {
    if (!itemOverlapsRange(item, range)) continue;
    collectMediaFromItem(item, usage);
    if (item.type === 'composition' && item.compositionId) {
      collectMediaIdsFromItems(compositions.get(item.compositionId)?.items, usage, null);
    }
  }

  return usage;
}

function collectMediaIdsFromItems(items, usage, range) {
  for (const item of items ?? []) {
    if (!itemOverlapsRange(item, range)) continue;
    collectMediaFromItem(item, usage);
  }
}

function collectMediaFromItem(item, usage) {
  if (!item?.mediaId || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) {
    return;
  }
  const existing = usage.get(item.mediaId) ?? {
    mediaId: item.mediaId,
    items: [],
  };
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

function itemOverlapsRange(item, range) {
  if (!range) return true;
  const start = Number(item?.from ?? 0);
  const end = start + Number(item?.durationInFrames ?? 0);
  return end > range.inFrame && start < range.outFrame;
}

function resolveProjectRenderRange(project, requestedRange, renderWholeProject) {
  if (renderWholeProject) return null;
  const fps = project.metadata?.fps ?? 30;
  if (requestedRange) return resolveRangeFrames(requestedRange, fps);
  const inPoint = project.timeline?.inPoint;
  const outPoint = project.timeline?.outPoint;
  if (inPoint !== undefined && inPoint !== null && outPoint !== undefined && outPoint !== null) {
    return validateRangeFrames(inPoint, outPoint);
  }
  return null;
}

function resolveRangeFrames(range, fps) {
  const startFrame = firstDefined(
    range.inFrame,
    range.startFrame,
    range.startSeconds === undefined ? undefined : Math.round(range.startSeconds * fps),
  ) ?? 0;
  const outFrame = firstDefined(
    range.outFrame,
    range.endFrame,
    range.endSeconds === undefined ? undefined : Math.round(range.endSeconds * fps),
    range.durationInFrames === undefined ? undefined : startFrame + range.durationInFrames,
    range.durationSeconds === undefined ? undefined : startFrame + Math.round(range.durationSeconds * fps),
  );
  if (outFrame === undefined) {
    throw new Error('render range requires outFrame, endFrame, endSeconds, durationInFrames, or durationSeconds');
  }
  return validateRangeFrames(startFrame, outFrame);
}

function validateRangeFrames(inFrame, outFrame) {
  if (!Number.isInteger(inFrame) || inFrame < 0) {
    throw new RangeError(`inFrame must be a non-negative integer, got ${inFrame}`);
  }
  if (!Number.isInteger(outFrame) || outFrame <= 0) {
    throw new RangeError(`outFrame must be a positive integer, got ${outFrame}`);
  }
  if (inFrame >= outFrame) {
    throw new RangeError(`inFrame must be before outFrame, got ${inFrame} >= ${outFrame}`);
  }
  return { inFrame, outFrame };
}

function buildRange(values) {
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

const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
]);

async function findWorkspaceMediaSource(mediaDir, list) {
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

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function mimeTypeFromFileName(file) {
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
