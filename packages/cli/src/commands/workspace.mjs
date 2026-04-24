import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import {
  buildRange,
  inspectWorkspaceMedia,
  inspectWorkspaceProject,
  listWorkspaceProjects,
} from '../workspace-core.mjs';

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
  if (subcommand !== 'projects' && subcommand !== 'list' && subcommand !== 'media' && subcommand !== 'inspect') {
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
    const report = await inspectWorkspaceMedia(resolve(workspace), selector, {
      range: buildRange(values),
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

  if (subcommand === 'inspect') {
    const selector = {
      project: values.project,
      projectId: values['project-id'],
    };
    if (!selector.project && !selector.projectId) {
      throw new Error('usage: freecut workspace inspect <dir> --project-id <id> [--json]');
    }
    const report = await inspectWorkspaceProject(resolve(workspace), selector, {
      readFile: deps.readFile,
      readdir: deps.readdir,
    });
    if (values.json) {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    writeInspectReport(stdout, report);
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
    '   or: freecut workspace inspect <dir> --project-id <id> [--json]\n' +
    '   or: freecut workspace media <dir> --project-id <id> [--start S --duration S] [--json]',
  );
}

function writeInspectReport(stdout, report) {
  const { project, counts } = report;
  stdout.write(`${project.name} (${project.id})\n`);
  stdout.write(
    `  ${project.resolution.width}x${project.resolution.height} @ ${project.resolution.fps}fps · ` +
    `${project.duration.toFixed(2)}s · schema ${project.schemaVersion ?? 'unknown'}\n`,
  );
  stdout.write(
    `  tracks: ${counts.tracks}  items: ${counts.items}  transitions: ${counts.transitions}  ` +
    `markers: ${counts.markers}  media: ${counts.referencedMedia}\n`,
  );
  for (const track of report.tracks) {
    stdout.write(
      `  - track ${track.id} "${track.name}" (${track.kind ?? 'video'}) ` +
      `order=${track.order} items=${track.itemCount}\n`,
    );
  }
  for (const item of report.items) {
    const end = item.from + item.durationInFrames;
    const media = item.mediaId ? ` media=${item.mediaId}` : '';
    stdout.write(`  - item ${item.id} type=${item.type} track=${item.trackId} frames=[${item.from}, ${end})${media}\n`);
  }
  if (report.media.missingLinks.length > 0) {
    stdout.write(`  missing media links: ${report.media.missingLinks.join(', ')}\n`);
  }
  if (report.media.orphanLinks.length > 0) {
    stdout.write(`  orphan media links: ${report.media.orphanLinks.join(', ')}\n`);
  }
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
