import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { lintSnapshot, parse } from '../sdk.mjs';
import { connectBridge } from '../cdp-bridge.mjs';
import {
  buildRange,
  loadWorkspaceRenderSource,
  mimeTypeFromFileName,
} from '@freecut/core';

const options = {
  output: { type: 'string', short: 'o' },
  project: { type: 'string' },
  'project-id': { type: 'string' },
  workspace: { type: 'string' },
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
  check: { type: 'boolean', default: false },
  'launch-browser': { type: 'boolean', default: false },
  'browser-path': { type: 'string' },
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
  if (values.workspace && file) {
    throw new Error('--workspace renders an existing workspace project; use --project or --project-id instead of a snapshot file');
  }
  if (values['launch-browser'] && values.host) {
    throw new Error('--launch-browser cannot be combined with --host');
  }

  const mode = validateMode(values.mode);
  const quality = validateChoice(values.quality, QUALITIES, '--quality');
  const format = values.format ?? (mode === 'audio' ? 'mp3' : 'mp4');
  if (mode === 'video') validateChoice(format, VIDEO_FORMATS, '--format');
  if (mode === 'audio') validateChoice(format, AUDIO_FORMATS, '--format');
  const codec = values.codec === undefined ? undefined : validateChoice(values.codec, VIDEO_CODECS, '--codec');
  const explicitPort = argv.some((arg) => arg === '--port' || arg.startsWith('--port='));
  let port = values.port === undefined ? 9222 : intOpt(values.port, '--port');
  const maxBytes = values['max-bytes'] === undefined ? undefined : intOpt(values['max-bytes'], '--max-bytes');
  const range = buildRange(values);

  let raw = null;
  let snapshot = null;
  let workspaceRender = null;
  if (file) {
    raw = await (deps.readFile ?? readFile)(file, 'utf8');
    snapshot = parse(raw);
    const lint = lintSnapshot(snapshot);
    if (lint.errorCount > 0) {
      throw new Error(`render aborted: project has ${lint.errorCount} lint error(s); run freecut lint ${file}`);
    }
  }
  if (values.workspace) {
    workspaceRender = await loadWorkspaceRenderSource(
      resolve(values.workspace),
      {
        project: values.project,
        projectId: values['project-id'],
      },
      {
        range,
        renderWholeProject: values['render-whole-project'],
      },
      deps,
    );
  }

  if (values.check) {
    if (!workspaceRender) {
      throw new Error('--check currently requires --workspace so media can be validated from disk');
    }
    writeWorkspaceRenderCheck(stdout, workspaceRender, {
      json: values.json,
      mode,
      quality,
      format,
      codec,
      port,
      url: values.url,
    });
    return;
  }

  if (workspaceRender?.missingSources.length) {
    throw new Error(
      `workspace media source file missing for ${workspaceRender.missingSources.map((m) => m.mediaId).join(', ')}; ` +
      'open the project once in FreeCut or relink/read the media so it is mirrored under media/{id}/',
    );
  }

  const connect = deps.connectBridge ?? connectBridge;
  const write = deps.writeFile ?? writeFile;
  const startMediaServer = deps.startWorkspaceMediaServer ?? startWorkspaceMediaServer;
  const mediaServer = workspaceRender
    ? await startMediaServer(workspaceRender.mediaSources)
    : null;
  let browser = null;
  let bridge = null;

  try {
    if (values['launch-browser']) {
      if (!explicitPort) port = await (deps.findAvailablePort ?? findAvailablePort)();
      const launchBrowser = deps.launchBrowser ?? launchRenderBrowser;
      browser = await launchBrowser({
        port,
        url: normalizeBrowserUrl(values.url),
        browserPath: values['browser-path'],
      });
    }

    bridge = await connect({
      host: values.host,
      port,
      url: browser?.url ?? values.url,
      anyTab: values['any-tab'],
    });
    await bridge.waitForApi();
    let sourceName = file;
    let projectMeta = snapshot?.project?.metadata;
    if (workspaceRender) {
      sourceName = workspaceRender.project.name;
      projectMeta = workspaceRender.project.metadata;
    } else if (file) {
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
    const result = workspaceRender
      ? await bridge.callApi('renderProjectExport', [{
          ...renderOptions,
          project: workspaceRender.project,
          mediaSources: mediaServer?.browserSources ?? {},
        }])
      : await bridge.callApi('renderExport', [renderOptions]);
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
    await bridge?.close?.().catch(() => {});
    await mediaServer?.close?.().catch(() => {});
    await browser?.close?.().catch(() => {});
  }
}

async function launchRenderBrowser({ port, url, browserPath }) {
  const executable = browserPath ?? await findChromeExecutable();
  const profileDir = await mkdtemp(join(tmpdir(), 'freecut-render-browser-'));
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--disable-extensions',
    url,
  ], {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  child.unref();

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await stopBrowserProcess(child.pid);
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await waitForCdp(port);
  } catch (error) {
    await close();
    throw error;
  }

  return { port, url, close };
}

async function findChromeExecutable() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    candidates.push(
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge');
  }

  for (const candidate of candidates.filter(Boolean)) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (await fileExists(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error('could not find Chrome/Edge; pass --browser-path or set CHROME_PATH');
}

async function fileExists(file) {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return port;
}

function normalizeBrowserUrl(raw) {
  const base = raw ?? 'http://localhost:5173/?agent=1';
  const withProtocol = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  const url = new URL(withProtocol);
  if (!url.searchParams.has('agent')) url.searchParams.set('agent', '1');
  return url.toString();
}

async function waitForCdp(port, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
      lastError = new Error(`CDP responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`launched browser did not expose Chrome DevTools on port ${port}: ${lastError?.message ?? 'timeout'}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function stopBrowserProcess(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('close', () => resolveStop());
      killer.on('error', () => resolveStop());
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already closed.
    }
  }
}

function writeWorkspaceRenderCheck(stdout, workspaceRender, opts) {
  const project = workspaceRender.project;
  const fps = project.metadata?.fps ?? 0;
  const range = workspaceRender.effectiveRange;
  const result = {
    ok: workspaceRender.missingSources.length === 0,
    workspace: workspaceRender.workspace,
    project: {
      id: project.id,
      name: project.name,
      width: project.metadata?.width ?? 0,
      height: project.metadata?.height ?? 0,
      fps,
      itemCount: project.timeline?.items?.length ?? 0,
    },
    render: {
      mode: opts.mode,
      quality: opts.quality,
      format: opts.format,
      codec: opts.codec ?? null,
      range: range
        ? {
            inFrame: range.inFrame,
            outFrame: range.outFrame,
            startSeconds: fps > 0 ? range.inFrame / fps : null,
            durationSeconds: fps > 0 ? (range.outFrame - range.inFrame) / fps : null,
          }
        : null,
      cdp: {
        port: opts.port,
        url: opts.url ?? null,
      },
    },
    media: workspaceRender.requiredMedia,
    missingMedia: workspaceRender.missingSources,
  };

  if (opts.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  stdout.write(`${result.ok ? 'ok' : 'missing media'}: workspace render check\n`);
  stdout.write(`project ${result.project.id} (${result.project.name}) ${result.project.width}x${result.project.height}@${result.project.fps}fps\n`);
  if (result.render.range) {
    stdout.write(
      `range ${result.render.range.inFrame}-${result.render.range.outFrame} ` +
      `(${result.render.range.durationSeconds?.toFixed(2)}s)\n`,
    );
  } else {
    stdout.write('range whole project\n');
  }
  stdout.write(`required media ${result.media.length}, missing ${result.missingMedia.length}\n`);
  for (const media of result.media) {
    stdout.write(
      `${media.sourceExists ? 'ok' : 'missing'}\t${media.mediaId}\t` +
      `${media.fileName ?? '(unknown)'}\t${media.itemCount} item(s)\n`,
    );
  }
}

async function startWorkspaceMediaServer(mediaSources) {
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const match = url.pathname.match(/^\/media\/([^/]+)$/);
      const mediaId = match ? decodeURIComponent(match[1]) : null;
      const source = mediaId ? mediaSources[mediaId] : null;
      if (!source) {
        res.writeHead(404);
        res.end();
        return;
      }

      const info = await stat(source.filePath);
      const total = info.size;
      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', source.mimeType || mimeTypeFromFileName(source.filePath));

      if (range) {
        const parsed = parseRange(range, total);
        if (!parsed) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          res.end();
          return;
        }
        const { start, end } = parsed;
        res.writeHead(206, {
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${total}`,
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(source.filePath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, { 'Content-Length': total });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(source.filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : 'media server error');
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const browserSources = Object.fromEntries(Object.entries(mediaSources).map(([mediaId, source]) => [
    mediaId,
    {
      url: `http://127.0.0.1:${port}/media/${encodeURIComponent(mediaId)}`,
      ...(source.keyframeTimestamps ? { keyframeTimestamps: source.keyframeTimestamps } : {}),
    },
  ]));

  return {
    browserSources,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

function parseRange(range, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return null;
  let start = match[1] === '' ? null : Number.parseInt(match[1], 10);
  let end = match[2] === '' ? null : Number.parseInt(match[2], 10);
  if (start === null && end === null) return null;
  if (start === null) {
    const suffixLength = end ?? 0;
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    end = end ?? total - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= total) {
    return null;
  }
  return { start, end: Math.min(end, total - 1) };
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
