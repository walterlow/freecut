import { parseArgs } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const options = {
  json: { type: 'boolean', default: false },
  'include-trashed': { type: 'boolean', default: false },
};

export async function runWorkspace(argv, { stdout }, deps = {}) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'projects' && subcommand !== 'list') {
    throw new Error('usage: freecut workspace projects <dir> [--json] [--include-trashed]');
  }

  const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true });
  const workspace = positionals[0];
  if (!workspace) {
    throw new Error('usage: freecut workspace projects <dir> [--json] [--include-trashed]');
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

async function readJsonIfExists(file, read) {
  try {
    return JSON.parse(await read(file, 'utf8'));
  } catch {
    return null;
  }
}
