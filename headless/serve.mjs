// FreeCut headless render service.
//
// Launches one warm headless Chrome + harness over a workspace and exposes a
// small HTTP API, so renders/edits avoid the per-call browser cold start.
// Requests are serialized (one page op at a time) to avoid GPU/CPU contention.
//
// Usage:
//   node headless/serve.mjs --workspace <dir> [--host 127.0.0.1] [--port 8787] [--build] [--head] [--harness-url <url>]
//
// API:
//   GET  /health                      -> { ok, harnessUrl }
//   GET  /projects                    -> [{ id, name, updatedAt }]
//   POST /render  { project|projectObject, codec?, container?, resolution?, fps?,
//                   quality?, in?, outSec?, duration?, audioOnly? }
//                                      -> the rendered video/audio file (attachment)
//   POST /edit    { project|projectObject, ops, ... }
//                                      -> { ok, project, applied, results } (edited project JSON)
//
// Example:
//   curl -X POST localhost:8787/render -H 'content-type: application/json' \
//     -d '{"project":"<id>","codec":"vp9","duration":5}' -o out.webm
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildProjectSnapshot,
  collectAddClipMedia,
  listProjectIdsUsingMedia,
  listProjects,
  loadProjectById,
  reconcileProjectMediaLinks,
  resolveMediaFile,
} from './lib/workspace.mjs'
import { parseArgs, chromeLaunchArgs } from './lib/cli.mjs'
import {
  assertHardwareGpuForJob,
  prepareJob,
  renderJob,
  startHarness,
  warningsHeaderValue,
} from './lib/render-core.mjs'
import { OperationQueue, OperationQueueError } from './lib/operation-queue.mjs'
import { PageSession, probeGpu } from './lib/page-session.mjs'
import {
  assertSinglePathComponent,
  HttpError,
  readJsonBody,
  readJsonBodyWithBytes,
  setHttpTimeouts,
} from './lib/http-security.mjs'
import {
  HEADLESS_API_VERSION,
  ContractValidationError,
  capabilities,
  editRequestSchema,
  lifecycleEditRequestSchema,
  mediaProbeRequestSchema,
  projectCreateRequestSchema,
  projectSaveRequestSchema,
  projectUpdateRequestSchema,
  renderRequestSchema,
  validate,
} from './lib/contract.mjs'
import {
  acquireWriterLock,
  assertAtomicReplace,
  assertPortableId,
  createProjectResource,
  getMediaResource,
  getProjectResource,
  listMediaResources,
  listProjectResources,
  saveProjectResource,
  updateMediaMetadata,
} from './lib/lifecycle-store.mjs'
import { withIdempotency } from './lib/idempotency.mjs'

const HELP = `Usage: node headless/serve.mjs --workspace <dir> [options]\n\nOptions:\n  --host <address>           Bind address (default: 127.0.0.1)\n  --port <n>                 HTTP port (default: 8787)\n  --render-timeout-ms <n>    Whole render deadline (default: 1800000)\n  --edit-timeout-ms <n>      Whole edit deadline (default: 120000)\n  --max-queue-depth <n>      Waiting operations allowed behind the active one (default: 8)\n  --shutdown-timeout-ms <n>  Graceful queue drain deadline (default: 30000)\n  --build  --head  --harness-url <url>\n`
const SERVE_OPTIONS = new Set([
  'workspace',
  'host',
  'port',
  'build',
  'head',
  'harness-url',
  'help',
  'render-timeout-ms',
  'edit-timeout-ms',
  'max-queue-depth',
  'shutdown-timeout-ms',
])

/** Resolve the service bind address without exposing native runs by default. */
export function resolveHost(args = {}, env = process.env) {
  const host = Object.prototype.hasOwnProperty.call(args, 'host')
    ? args.host
    : Object.prototype.hasOwnProperty.call(env, 'FREECUT_HOST')
      ? env.FREECUT_HOST
      : '127.0.0.1'

  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error('Host must be a non-empty string (--host or FREECUT_HOST)')
  }
  return host.trim()
}

export function installWorkspaceChangeMonitor({
  workspace,
  onChange,
  onPoll,
  watch = fs.watch,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  warn = console.warn,
}) {
  let watcher = null
  let pollTimer = null
  const startPolling = (reason) => {
    if (pollTimer) return
    watcher?.close()
    watcher = null
    warn(`${reason}; using revision polling`)
    pollTimer = setIntervalFn(onPoll, 750)
  }
  try {
    watcher = watch(
      workspace,
      { recursive: true, persistent: false },
      (_eventType, fileName) => onChange(fileName),
    )
    watcher.on('error', (error) => {
      startPolling(`Workspace watcher failed: ${error.message}`)
    })
  } catch (error) {
    startPolling(`Recursive workspace watcher unavailable: ${error.message}`)
  }
  return () => {
    if (pollTimer) clearIntervalFn(pollTimer)
    watcher?.close()
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (!origin) return
  try {
    const url = new URL(origin)
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Headers', 'content-type,idempotency-key,last-event-id')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS')
      res.setHeader('Vary', 'Origin')
    }
  } catch {
    // Invalid Origin is treated as untrusted: no CORS headers.
  }
}
/** Heuristic: is this a software (CPU) WebGPU adapter rather than a real GPU? */
function isSoftwareGpu(gpu) {
  if (!gpu?.available) return true
  const s = `${gpu.vendor} ${gpu.architecture} ${gpu.description}`.toLowerCase()
  return /llvmpipe|lavapipe|swiftshader|software|mesa/.test(s)
}

async function main() {
  const { chromium } = await import('playwright')
  const args = parseArgs(process.argv.slice(2), { allowed: SERVE_OPTIONS })
  if (args.help) {
    console.log(HELP)
    return
  }
  const workspace = args.workspace
  if (!workspace) throw new Error('Missing --workspace <dir>')
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`)
  const releaseWriterLock = await acquireWriterLock(workspace)
  try {
    await assertAtomicReplace(workspace)
  } catch (error) {
    await releaseWriterLock()
    throw error
  }
  const host = resolveHost(args)
  const port = args.port ? Number(args.port) : 8787
  const positiveInt = (name, fallback, { min = 1, max = 86_400_000 } = {}) => {
    const value = args[name] === undefined ? fallback : Number(args[name])
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`--${name} must be an integer between ${min} and ${max}`)
    }
    return value
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('--port must be an integer between 0 and 65535')
  const renderTimeoutMs = positiveInt('render-timeout-ms', 30 * 60_000)
  const editTimeoutMs = positiveInt('edit-timeout-ms', 2 * 60_000)
  const maxQueueDepth = positiveInt('max-queue-depth', 8, { min: 0, max: 10_000 })
  const shutdownTimeoutMs = positiveInt('shutdown-timeout-ms', 30_000)

  const { harnessUrl, mediaUrlOf, closeServers } = await startHarness({
    workspace,
    devUrl: args['harness-url'],
    build: args.build,
  })

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.head,
    args: chromeLaunchArgs(),
  })
  const session = new PageSession({
    browser,
    harnessUrl,
    onPageError: (e) => console.error('[pageerror]', e.message),
  })
  await session.open()

  // Report the WebGPU adapter so it's obvious whether this is a real GPU.
  let gpu = await probeGpu(session.page)
  if (gpu.available) {
    console.log(
      `WebGPU adapter: ${gpu.vendor || '?'} / ${gpu.architecture || gpu.description || '?'}`,
    )
  }
  if (isSoftwareGpu(gpu)) {
    console.warn(
      'WARNING: WebGPU is software (no real GPU) — GPU-effect renders are rejected. ' +
        'Run on a Linux host with an NVIDIA GPU + Container Toolkit (--gpus all ' +
        '-e NVIDIA_DRIVER_CAPABILITIES=all), or render natively on Windows/macOS.',
    )
  }

  const queue = new OperationQueue({
    maxQueueDepth,
    recover: async (error) => {
      console.error(`Recreating browser page after failed operation: ${error.message ?? error}`)
      if (!queue.accepting) {
        await session.close()
        return
      }
      await session.recreate()
      gpu = await probeGpu(session.page)
    },
  })

  const tmpDir = path.join(os.tmpdir(), 'freecut-serve')
  fs.mkdirSync(tmpDir, { recursive: true })
  let counter = 0
  let eventCounter = 0
  const eventClients = new Map()
  const lastPublishedRevision = new Map()

  const writeSseEvent = (res, event) => {
    res.write(`id: ${event.eventId}\n`)
    res.write(`event: project.changed\n`)
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const publishProjectChange = (projectId, snapshot, source, changedPaths = []) => {
    if (lastPublishedRevision.get(projectId) === snapshot.revision) return
    lastPublishedRevision.set(projectId, snapshot.revision)
    const event = {
      eventId: `${Date.now()}-${++eventCounter}`,
      type: 'project.changed',
      projectId,
      revision: snapshot.revision,
      source,
      changedPaths,
      timestamp: Date.now(),
    }
    for (const res of eventClients.get(projectId) ?? []) writeSseEvent(res, event)
  }

  const publishCurrentProjectChange = (projectId, source, changedPaths = []) => {
    try {
      publishProjectChange(
        projectId,
        buildProjectSnapshot(workspace, projectId),
        source,
        changedPaths,
      )
    } catch (error) {
      console.warn(`Unable to publish project change for ${projectId}: ${error.message ?? error}`)
    }
  }

  const handleRender = async (req, res, { normalizeInline = false } = {}) => {
    let body = validate(renderRequestSchema, await readJsonBody(req))
    if (normalizeInline && body.projectObject) {
      body = { ...body, projectObject: await browserNormalize(body.projectObject) }
    }
    if (body.project) assertSinglePathComponent(body.project, 'project id')
    const outPath = path.join(tmpDir, `render-${process.pid}-${++counter}.out`)
    const job = prepareJob(workspace, { ...body, out: outPath }, mediaUrlOf)
    assertHardwareGpuForJob(job, isSoftwareGpu(gpu))

    const t0 = Date.now()
    const summary = await queue.enqueue(
      () => renderJob(session.page, job, { downloadTimeoutMs: 0 }),
      { timeoutMs: renderTimeoutMs, kind: 'render' },
    )
    console.log(
      `render ${job.project.name ?? job.project.id} -> ${summary.effectiveSettings.container} ` +
        `(${(summary.fileSize / 1e6).toFixed(2)}MB, ${summary.durationSeconds.toFixed(2)}s) in ${Date.now() - t0}ms`,
    )

    res.writeHead(200, {
      'Content-Type': summary.mimeType,
      'Content-Length': fs.statSync(summary.outputPath).size,
      'Content-Disposition': `attachment; filename="${summary.fileName}"`,
      // Header values must be ASCII; sanitize defensively so a warning never
      // turns a successful render into a 500.
      ...(summary.warnings?.length
        ? { 'X-Freecut-Warnings': warningsHeaderValue(summary.warnings) }
        : {}),
    })
    const stream = fs.createReadStream(summary.outputPath)
    stream.pipe(res)
    stream.on('close', () => fs.rm(summary.outputPath, () => {}))
  }

  const handleEdit = async (req, res) => {
    const body = validate(editRequestSchema, await readJsonBody(req))
    if (body.project) assertSinglePathComponent(body.project, 'project id')
    const project = body.projectObject ?? loadProjectById(workspace, body.project).project
    const ops = body.ops
    const media = collectAddClipMedia(workspace, ops)
    const result = await queue.enqueue(
      () =>
        session.page.evaluate((payload) => window.freecut.editProject(payload), {
          project,
          ops,
          media,
        }),
      { timeoutMs: editTimeoutMs, kind: 'edit' },
    )
    sendJson(res, 200, result)
  }

  const handleSnapshot = async (res, projectId) => {
    sendJson(res, 200, buildProjectSnapshot(workspace, projectId))
  }

  const handleEvents = async (req, res, projectId) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    let clients = eventClients.get(projectId)
    if (!clients) {
      clients = new Set()
      eventClients.set(projectId, clients)
    }
    clients.add(res)

    try {
      const snapshot = buildProjectSnapshot(workspace, projectId)
      writeSseEvent(res, {
        eventId: `${Date.now()}-${++eventCounter}`,
        type: 'project.changed',
        projectId,
        revision: snapshot.revision,
        source: 'initial-snapshot',
        changedPaths: [],
        timestamp: Date.now(),
      })
    } catch (error) {
      res.write(`event: project.error\ndata: ${JSON.stringify({ error: error.message })}\n\n`)
    }

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
    req.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(res)
      if (clients.size === 0) eventClients.delete(projectId)
    })
  }

  const browserNormalize = (project) =>
    queue.enqueue(
      () => session.page.evaluate((value) => window.freecut.normalizeProject(value), project),
      { timeoutMs: editTimeoutMs, kind: 'project-normalize' },
    )

  const resourceEnvelope = (resource) => ({
    ok: true,
    apiVersion: HEADLESS_API_VERSION,
    ...resource,
  })

  const handleV1ProjectList = async (url, res) => {
    const limitText = url.searchParams.get('limit')
    const limit = limitText === null ? 100 : Number(limitText)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new HttpError(400, 'VALIDATION_ERROR', 'limit must be an integer between 1 and 1000')
    let offset = 0
    const cursor = url.searchParams.get('cursor')
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (!Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error('invalid')
        offset = decoded.offset
      } catch {
        throw new HttpError(400, 'VALIDATION_ERROR', 'cursor is invalid')
      }
    }
    const all = await listProjectResources(workspace)
    const projects = all.slice(offset, offset + limit)
    const nextOffset = offset + projects.length
    const nextCursor =
      nextOffset < all.length
        ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url')
        : null
    sendJson(res, 200, {
      ok: true,
      apiVersion: HEADLESS_API_VERSION,
      projects,
      nextCursor,
    })
  }

  const handleV1ProjectCreate = async (req, res) => {
    const { value: raw, rawBytes } = await readJsonBodyWithBytes(req, { maxBytes: 1024 * 1024 })
    const body = validate(projectCreateRequestSchema, raw)
    const route = '/v1/projects'
    const result = await withIdempotency(
      workspace,
      {
        key: req.headers['idempotency-key'],
        method: 'POST',
        route,
        requestBytes: rawBytes,
      },
      async () => {
        const project = await queue.enqueue(
          () => session.page.evaluate((value) => window.freecut.createProject(value), body),
          { timeoutMs: editTimeoutMs, kind: 'project-create' },
        )
        const resource = await createProjectResource(workspace, project)
        publishCurrentProjectChange(resource.id, 'headless-api', [
          ['projects', resource.id, 'project.json'],
        ])
        return { status: 201, response: resourceEnvelope(resource) }
      },
    )
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true')
    sendJson(res, result.status, result.response)
  }

  const handleV1ProjectSave = async (req, res, id) => {
    const body = validate(
      projectSaveRequestSchema,
      await readJsonBody(req, { maxBytes: 16 * 1024 * 1024 }),
    )
    if (body.project.id !== undefined && body.project.id !== id)
      throw new HttpError(400, 'PROJECT_ID_MISMATCH', 'Project body id must equal the path id')
    const project = await browserNormalize({ ...body.project, id })
    const resource = await saveProjectResource(workspace, id, project, body)
    reconcileProjectMediaLinks(workspace, resource.project, id)
    publishCurrentProjectChange(id, 'headless-api', [
      ['projects', id, 'project.json'],
      ['projects', id, 'media-links.json'],
    ])
    sendJson(res, 200, resourceEnvelope(resource))
  }

  const handleV1ProjectUpdate = async (req, res, id) => {
    const body = validate(
      projectUpdateRequestSchema,
      await readJsonBody(req, { maxBytes: 1024 * 1024 }),
    )
    const current = await getProjectResource(workspace, id)
    const project = await browserNormalize({
      ...current.project,
      ...(body.updates.name !== undefined ? { name: body.updates.name } : {}),
      ...(body.updates.description !== undefined ? { description: body.updates.description } : {}),
      metadata: {
        ...current.project.metadata,
        ...(body.updates.width !== undefined ? { width: body.updates.width } : {}),
        ...(body.updates.height !== undefined ? { height: body.updates.height } : {}),
        ...(body.updates.fps !== undefined ? { fps: body.updates.fps } : {}),
        ...(body.updates.backgroundColor !== undefined
          ? { backgroundColor: body.updates.backgroundColor }
          : {}),
      },
    })
    const resource = await saveProjectResource(workspace, id, project, body)
    publishCurrentProjectChange(id, 'headless-api', [['projects', id, 'project.json']])
    sendJson(res, 200, resourceEnvelope(resource))
  }

  const handleV1ProjectEdit = async (req, res, id) => {
    const { value: raw, rawBytes } = await readJsonBodyWithBytes(req, {
      maxBytes: 16 * 1024 * 1024,
    })
    const body = validate(lifecycleEditRequestSchema, raw)
    const execute = async () => {
      const current = await getProjectResource(workspace, id)
      const media = collectAddClipMedia(workspace, body.ops)
      const result = await queue.enqueue(
        () =>
          session.page.evaluate((payload) => window.freecut.editProject(payload), {
            project: current.project,
            ops: body.ops,
            media,
          }),
        { timeoutMs: editTimeoutMs, kind: 'edit' },
      )
      if (!body.persist)
        return {
          status: 200,
          response: {
            ...result,
            apiVersion: HEADLESS_API_VERSION,
            persisted: false,
            baseRevision: current.revision,
          },
        }
      const project = await browserNormalize(result.project)
      const resource = await saveProjectResource(workspace, id, project, body)
      reconcileProjectMediaLinks(workspace, resource.project, id)
      publishCurrentProjectChange(id, 'headless-api', [
        ['projects', id, 'project.json'],
        ['projects', id, 'media-links.json'],
      ])
      return {
        status: 200,
        response: {
          ...result,
          apiVersion: HEADLESS_API_VERSION,
          project: resource.project,
          persisted: true,
          revision: resource.revision,
          warnings: resource.warnings,
        },
      }
    }
    if (!body.persist) {
      const result = await execute()
      sendJson(res, result.status, result.response)
      return
    }
    const result = await withIdempotency(
      workspace,
      {
        key: req.headers['idempotency-key'],
        method: 'POST',
        route: `/v1/projects/${id}/edit`,
        requestBytes: rawBytes,
      },
      execute,
    )
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true')
    sendJson(res, result.status, result.response)
  }

  const handleV1MediaProbe = async (req, res, id) => {
    const body = validate(
      mediaProbeRequestSchema,
      await readJsonBody(req, { maxBytes: 1024 * 1024 }),
    )
    const current = await getMediaResource(workspace, id)
    const source = resolveMediaFile(workspace, id)
    if (!source) throw new HttpError(422, 'MISSING_MEDIA', 'Media source file is missing')
    const probe = await queue.enqueue(
      () =>
        session.page.evaluate((payload) => window.freecut.probeMedia(payload), {
          url: mediaUrlOf(id),
          fileName: path.basename(source),
          mimeType: current.metadata.mimeType,
        }),
      { timeoutMs: editTimeoutMs, kind: 'media-probe' },
    )
    if (!body.persist) {
      sendJson(res, 200, {
        ok: true,
        apiVersion: HEADLESS_API_VERSION,
        mediaId: id,
        probe,
        persisted: false,
      })
      return
    }
    const saved = await updateMediaMetadata(workspace, id, probe, body)
    for (const projectId of listProjectIdsUsingMedia(workspace, id)) {
      publishCurrentProjectChange(projectId, 'headless-api', [['media', id, 'metadata.json']])
    }
    sendJson(res, 200, {
      ok: true,
      apiVersion: HEADLESS_API_VERSION,
      mediaId: id,
      probe,
      persisted: true,
      revision: saved.revision,
    })
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const route = `${req.method} ${url.pathname}`
    const projectMatch = /^\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(url.pathname)
    const projectEditMatch = /^\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/edit$/.exec(
      url.pathname,
    )
    const projectSnapshotMatch =
      /^\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/snapshot$/.exec(url.pathname)
    const mediaMatch = /^\/v1\/media\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(url.pathname)
    const mediaProbeMatch = /^\/v1\/media\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/probe$/.exec(
      url.pathname,
    )
    const handler =
      projectSnapshotMatch && req.method === 'GET'
        ? () => handleSnapshot(res, assertPortableId(projectSnapshotMatch[1], 'project id'))
        : route === 'GET /v1/events'
          ? () => {
              const projectId = url.searchParams.get('projectId')
              if (!projectId) {
                throw new HttpError(400, 'VALIDATION_ERROR', 'Missing projectId')
              }
              return handleEvents(req, res, assertPortableId(projectId, 'project id'))
            }
          : route === 'GET /health'
            ? async () => {
                sendJson(res, 200, {
                  ok: true,
                  apiVersion: HEADLESS_API_VERSION,
                  gpu,
                  software: isSoftwareGpu(gpu),
                  harnessUrl,
                })
              }
            : route === 'GET /capabilities'
              ? async () => sendJson(res, 200, capabilities())
              : route === 'GET /v1/capabilities'
                ? async () => sendJson(res, 200, { ok: true, ...capabilities() })
                : route === 'POST /v1/projects'
                  ? () => handleV1ProjectCreate(req, res)
                  : route === 'GET /v1/projects'
                    ? () => handleV1ProjectList(url, res)
                    : projectEditMatch && req.method === 'POST'
                      ? () =>
                          handleV1ProjectEdit(
                            req,
                            res,
                            assertPortableId(projectEditMatch[1], 'project id'),
                          )
                      : projectMatch && req.method === 'GET'
                        ? async () =>
                            sendJson(
                              res,
                              200,
                              resourceEnvelope(
                                await getProjectResource(
                                  workspace,
                                  assertPortableId(projectMatch[1], 'project id'),
                                ),
                              ),
                            )
                        : projectMatch && req.method === 'PUT'
                          ? () =>
                              handleV1ProjectSave(
                                req,
                                res,
                                assertPortableId(projectMatch[1], 'project id'),
                              )
                          : projectMatch && req.method === 'PATCH'
                            ? () =>
                                handleV1ProjectUpdate(
                                  req,
                                  res,
                                  assertPortableId(projectMatch[1], 'project id'),
                                )
                            : route === 'GET /v1/media'
                              ? async () =>
                                  sendJson(res, 200, {
                                    ok: true,
                                    apiVersion: HEADLESS_API_VERSION,
                                    media: await listMediaResources(workspace),
                                  })
                              : mediaProbeMatch && req.method === 'POST'
                                ? () =>
                                    handleV1MediaProbe(
                                      req,
                                      res,
                                      assertPortableId(mediaProbeMatch[1], 'media id'),
                                    )
                                : mediaMatch && req.method === 'GET'
                                  ? async () =>
                                      sendJson(
                                        res,
                                        200,
                                        resourceEnvelope(
                                          await getMediaResource(
                                            workspace,
                                            assertPortableId(mediaMatch[1], 'media id'),
                                          ),
                                        ),
                                      )
                                  : route === 'POST /v1/render'
                                    ? () => handleRender(req, res, { normalizeInline: true })
                                    : route === 'GET /projects'
                                      ? async () => sendJson(res, 200, listProjects(workspace))
                                      : route === 'POST /render'
                                        ? () => handleRender(req, res)
                                        : route === 'POST /edit'
                                          ? () => handleEdit(req, res)
                                          : null
    if (!handler) {
      sendJson(res, 404, { error: `No route: ${route}` })
      return
    }
    handler().catch((e) => {
      console.error(`${route} failed:`, e.message ?? e)
      if (!res.headersSent) {
        const validation = e instanceof ContractValidationError
        const missingMedia = e.code === 'MISSING_MEDIA'
        const status = validation
          ? 400
          : missingMedia
            ? 422
            : e instanceof OperationQueueError || e instanceof HttpError
              ? e.statusCode
              : 500
        if (status === 413 || status === 408) res.setHeader('Connection', 'close')
        if (status === 413 || status === 408) res.once('finish', () => req.destroy())
        sendJson(res, status, {
          ok: false,
          apiVersion: HEADLESS_API_VERSION,
          error: {
            code: validation ? (e.code ?? 'INVALID_JSON') : (e.code ?? 'INTERNAL_ERROR'),
            message:
              validation ||
              missingMedia ||
              e instanceof OperationQueueError ||
              e instanceof HttpError
                ? e.message
                : 'Internal server error',
            fields: e.fields ?? [],
            ...(missingMedia ? { mediaIds: e.mediaIds } : {}),
            apiVersion: HEADLESS_API_VERSION,
            ...(e.expectedRevision ? { expectedRevision: e.expectedRevision } : {}),
            ...(e.actualRevision ? { actualRevision: e.actualRevision } : {}),
          },
        })
      } else res.destroy()
    })
  })
  setHttpTimeouts(server)

  // The default remains loopback-only because the render service has no auth.
  // Network exposure must be an explicit CLI/environment configuration choice.
  await new Promise((resolve) => server.listen(port, host, resolve))
  console.log(`FreeCut render service on http://${host}:${port}  (workspace: ${workspace})`)
  console.log(
    `  GET /health  GET /capabilities  GET /projects  POST /render  POST /edit  ` +
      `GET /v1/projects/:id/snapshot  GET /v1/events`,
  )

  const pendingProjectPaths = new Map()
  let watchDebounce = null
  const scheduleProjectChange = (projectId, changedPath) => {
    let paths = pendingProjectPaths.get(projectId)
    if (!paths) {
      paths = new Set()
      pendingProjectPaths.set(projectId, paths)
    }
    paths.add(changedPath)
    clearTimeout(watchDebounce)
    watchDebounce = setTimeout(() => {
      const pending = [...pendingProjectPaths.entries()]
      pendingProjectPaths.clear()
      for (const [id, changed] of pending) {
        try {
          const snapshot = buildProjectSnapshot(workspace, id)
          publishProjectChange(
            id,
            snapshot,
            'external-filesystem',
            [...changed].map((value) => value.split('/').filter(Boolean)),
          )
        } catch {
          // Project may have been removed between the event and the debounce.
        }
      }
    }, 250)
  }

  const handleWorkspaceChange = (fileName) => {
    if (!fileName) return
    const relative = String(fileName).replaceAll('\\', '/')
    if (relative.includes('/cache/')) return
    const parts = relative.split('/').filter(Boolean)
    if (parts[0] === 'projects' && parts[1]) {
      scheduleProjectChange(parts[1], relative)
      return
    }
    if (parts[0] === 'media' && parts[1]) {
      for (const projectId of listProjectIdsUsingMedia(workspace, parts[1])) {
        scheduleProjectChange(projectId, relative)
      }
      return
    }
    if (relative === 'index.json') {
      for (const project of listProjects(workspace)) scheduleProjectChange(project.id, relative)
    }
  }

  const stopWorkspaceChangeMonitor = installWorkspaceChangeMonitor({
    workspace,
    onChange: handleWorkspaceChange,
    onPoll: () => {
      for (const project of listProjects(workspace)) scheduleProjectChange(project.id, 'poll')
    },
  })

  let shuttingDown
  const shutdown = () =>
    (shuttingDown ??= (async () => {
      console.log('\nShutting down...')
      clearTimeout(watchDebounce)
      stopWorkspaceChangeMonitor()
      for (const clients of eventClients.values()) {
        for (const client of clients) client.end()
      }
      const serverClosed = new Promise((resolve) => server.close(resolve))
      try {
        await queue.shutdown(shutdownTimeoutMs)
      } catch (error) {
        console.error(error.message)
      } finally {
        await session.close()
        await browser.close()
        await closeServers()
        await releaseWriterLock()
        let closeTimer
        const closed = await Promise.race([
          serverClosed.then(() => true),
          new Promise((resolve) => {
            closeTimer = setTimeout(() => resolve(false), shutdownTimeoutMs)
          }),
        ])
        clearTimeout(closeTimer)
        if (!closed) server.closeAllConnections?.()
      }
    })())
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('\nService failed to start:', e.message ?? e)
    process.exit(1)
  })
}
