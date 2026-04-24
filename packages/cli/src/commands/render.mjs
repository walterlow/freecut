import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lintSnapshot, parse } from '../sdk.mjs';
import { connectBridge } from '../cdp-bridge.mjs';

const options = {
  output: { type: 'string', short: 'o' },
  project: { type: 'string' },
  'project-id': { type: 'string' },
  mode: { type: 'string', default: 'video' },
  quality: { type: 'string', default: 'high' },
  format: { type: 'string' },
  codec: { type: 'string' },
  width: { type: 'string' },
  height: { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  duration: { type: 'string' },
  'in-frame': { type: 'string' },
  'out-frame': { type: 'string' },
  'render-whole-project': { type: 'boolean', default: false },
  'max-bytes': { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string', default: '9222' },
  url: { type: 'string' },
  'any-tab': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
};

const VIDEO_FORMATS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const AUDIO_FORMATS = new Set(['mp3', 'aac', 'wav']);
const QUALITIES = new Set(['low', 'medium', 'high', 'ultra']);
const VIDEO_CODECS = new Set(['h264', 'h265', 'vp8', 'vp9', 'av1', 'prores']);

export async function runRender(argv, { stdout }, deps = {}) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  const projectSelector = values['project-id'] ?? values.project;
  if (!file && !projectSelector) {
    throw new Error(
      'usage: freecut render <file> [--output out.mp4] OR freecut render --project ABC --output out.mp4',
    );
  }
  if (file && projectSelector) {
    throw new Error('render accepts either a snapshot file or --project/--project-id, not both');
  }

  const mode = validateMode(values.mode);
  const quality = validateChoice(values.quality, QUALITIES, '--quality');
  const format = values.format ?? (mode === 'audio' ? 'mp3' : 'mp4');
  if (mode === 'video') validateChoice(format, VIDEO_FORMATS, '--format');
  if (mode === 'audio') validateChoice(format, AUDIO_FORMATS, '--format');
  const codec = values.codec === undefined ? undefined : validateChoice(values.codec, VIDEO_CODECS, '--codec');
  const port = intOpt(values.port, '--port');
  const maxBytes = values['max-bytes'] === undefined ? undefined : intOpt(values['max-bytes'], '--max-bytes');
  const range = buildRange(values);

  let raw = null;
  let snapshot = null;
  if (file) {
    raw = await (deps.readFile ?? readFile)(file, 'utf8');
    snapshot = parse(raw);
    const lint = lintSnapshot(snapshot);
    if (lint.errorCount > 0) {
      throw new Error(`render aborted: project has ${lint.errorCount} lint error(s); run freecut lint ${file}`);
    }
  }

  const connect = deps.connectBridge ?? connectBridge;
  const write = deps.writeFile ?? writeFile;
  const bridge = await connect({
    host: values.host,
    port,
    url: values.url,
    anyTab: values['any-tab'],
  });

  try {
    await bridge.waitForApi();
    let sourceName = file;
    let projectMeta = snapshot?.project?.metadata;
    if (file) {
      await bridge.callApi('loadSnapshot', [raw]);
    } else {
      const opened = await openProject(bridge, {
        project: values.project,
        projectId: values['project-id'],
      });
      sourceName = opened.name;
      projectMeta = await bridge.callApi('getProjectMeta');
    }
    const renderOptions = {
      mode,
      quality,
      ...(codec !== undefined && { codec }),
      ...(mode === 'video' ? { videoContainer: format } : { audioContainer: format }),
      ...(values.width !== undefined || values.height !== undefined
        ? { resolution: {
            width: values.width !== undefined ? intOpt(values.width, '--width') : projectMeta.width,
            height: values.height !== undefined ? intOpt(values.height, '--height') : projectMeta.height,
          } }
        : {}),
      renderWholeProject: values['render-whole-project'],
      ...(range ? { range } : {}),
      ...(maxBytes !== undefined && { maxBytes }),
    };
    const result = await bridge.callApi('renderExport', [renderOptions]);
    const output = resolve(values.output ?? defaultOutput(sourceName, result.extension));
    const bytes = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, 'base64')));
    await write(output, bytes);

    if (values.json) {
      stdout.write(`${JSON.stringify({
        output,
        mimeType: result.mimeType,
        duration: result.duration,
        fileSize: result.fileSize,
        chunks: result.chunks.length,
      }, null, 2)}\n`);
    } else {
      stdout.write(`rendered ${output} (${result.fileSize} bytes, ${result.duration.toFixed(2)}s)\n`);
    }
  } finally {
    await bridge.close?.().catch(() => {});
  }
}

function validateMode(value) {
  if (value === 'video' || value === 'audio') return value;
  throw new Error(`--mode must be video or audio, got ${value}`);
}

function validateChoice(value, allowed, label) {
  if (allowed.has(value)) return value;
  throw new Error(`${label} must be one of ${[...allowed].join(', ')}, got ${value}`);
}

function intOpt(raw, label) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${label} must be a positive integer, got ${raw}`);
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

function frameOpt(raw, label, allowZero = true) {
  const n = Number.parseInt(raw, 10);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, got ${raw}`);
  }
  return n;
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

async function openProject(bridge, { project, projectId }) {
  if (projectId) return bridge.callApi('openProject', [projectId]);
  const projects = await bridge.callApi('listProjects');
  const exact = projects.find((p) => p.name === project || p.id === project);
  const folded = exact ?? projects.find((p) => p.name.toLowerCase() === project.toLowerCase());
  if (!folded) {
    throw new Error(`no project matched ${JSON.stringify(project)}; available projects: ${projects.map((p) => p.name).join(', ')}`);
  }
  return bridge.callApi('openProject', [folded.id]);
}

function defaultOutput(sourceName, extension) {
  if (sourceName && /\.fcproject$/i.test(sourceName)) return replaceExtension(sourceName, extension);
  const safe = String(sourceName ?? 'render')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    || 'render';
  return `${safe}.${extension}`;
}

function replaceExtension(file, extension) {
  const normalized = file.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const dot = normalized.lastIndexOf('.');
  const hasExtension = dot > slash;
  return hasExtension ? `${file.slice(0, dot)}.${extension}` : `${file}.${extension}`;
}
