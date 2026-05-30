// FreeCut headless render service.
//
// Launches one warm headless Chrome + harness over a workspace and exposes a
// small HTTP API, so renders/edits avoid the per-call browser cold start.
// Requests are serialized (one page op at a time) to avoid GPU/CPU contention.
//
// Usage:
//   node headless/serve.mjs --workspace <dir> [--port 8787] [--build] [--head] [--harness-url <url>]
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
import { chromium } from 'playwright'
import { loadProject, listProjects, collectAddClipMedia } from './lib/workspace.mjs'
import { parseArgs, chromeLaunchArgs } from './lib/cli.mjs'
import { prepareJob, renderJob, startHarness } from './lib/render-core.mjs'

const CONTAINER_MIME = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024 * 1024) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e.message}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

/** Inspect the WebGPU adapter so operators can confirm a real GPU vs software. */
async function probeGpu(page) {
  return page
    .evaluate(async () => {
      if (!globalThis.navigator?.gpu) return { available: false }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) return { available: false }
      const info = adapter.info ?? {}
      return {
        available: true,
        vendor: info.vendor ?? '',
        architecture: info.architecture ?? '',
        description: info.description ?? '',
      }
    })
    .catch(() => ({ available: false }))
}

/** Heuristic: is this a software (CPU) WebGPU adapter rather than a real GPU? */
function isSoftwareGpu(gpu) {
  if (!gpu?.available) return true
  const s = `${gpu.vendor} ${gpu.architecture} ${gpu.description}`.toLowerCase()
  return /llvmpipe|lavapipe|swiftshader|software|mesa/.test(s)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workspace = args.workspace
  if (!workspace) throw new Error('Missing --workspace <dir>')
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`)
  const port = args.port ? Number(args.port) : 8787

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
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.exposeBinding('__freecutProgress', () => {})
  await page.goto(harnessUrl, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

  // Report the WebGPU adapter so it's obvious whether this is a real GPU.
  const gpu = await probeGpu(page)
  if (gpu.available) {
    console.log(`WebGPU adapter: ${gpu.vendor || '?'} / ${gpu.architecture || gpu.description || '?'}`)
  }
  if (isSoftwareGpu(gpu)) {
    console.warn(
      'WARNING: WebGPU is software (no real GPU) — GPU effects will fail. ' +
        'Run on a Linux host with an NVIDIA GPU + Container Toolkit (--gpus all ' +
        '-e NVIDIA_DRIVER_CAPABILITIES=all), or render natively on Windows/macOS.',
    )
  }

  // Serialize page operations: one render/edit at a time.
  let queue = Promise.resolve()
  const enqueue = (fn) => {
    const run = queue.then(fn, fn)
    queue = run.then(
      () => {},
      () => {},
    )
    return run
  }

  const tmpDir = path.join(os.tmpdir(), 'freecut-serve')
  fs.mkdirSync(tmpDir, { recursive: true })
  let counter = 0

  const handleRender = async (req, res) => {
    const body = await readJsonBody(req)
    const container = body.container ?? (body.audioOnly ? 'mp3' : undefined)
    const outPath = path.join(tmpDir, `render-${process.pid}-${++counter}.${container ?? 'out'}`)
    const job = prepareJob(workspace, { ...body, out: outPath }, mediaUrlOf)
    // Fix the extension to the (possibly fallback-adjusted) container after settings build.
    const finalOut = path.join(tmpDir, `render-${process.pid}-${counter}.${job.settings.container}`)
    job.outPath = finalOut

    const t0 = Date.now()
    const summary = await enqueue(() => renderJob(page, job))
    console.log(
      `render ${job.project.name ?? job.project.id} -> ${job.settings.container} ` +
        `(${(summary.fileSize / 1e6).toFixed(2)}MB, ${summary.durationSeconds.toFixed(2)}s) in ${Date.now() - t0}ms`,
    )

    res.writeHead(200, {
      'Content-Type': CONTAINER_MIME[job.settings.container] ?? 'application/octet-stream',
      'Content-Length': fs.statSync(finalOut).size,
      'Content-Disposition': `attachment; filename="${path.basename(finalOut)}"`,
      // Header values must be ASCII; sanitize defensively so a warning never
      // turns a successful render into a 500.
      ...(summary.warnings?.length
        ? { 'X-Freecut-Warnings': JSON.stringify(summary.warnings).replace(/[^\t\x20-\x7E]/g, ' ') }
        : {}),
    })
    const stream = fs.createReadStream(finalOut)
    stream.pipe(res)
    stream.on('close', () => fs.rm(finalOut, () => {}))
  }

  const handleEdit = async (req, res) => {
    const body = await readJsonBody(req)
    const project = body.projectObject ?? loadProject(workspace, body.project).project
    const ops = Array.isArray(body.ops) ? body.ops : []
    const media = collectAddClipMedia(workspace, ops)
    const result = await enqueue(() =>
      page.evaluate((payload) => window.freecut.editProject(payload), { project, ops, media }),
    )
    sendJson(res, 200, result)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = `${req.method} ${url.pathname}`
    const handler =
      route === 'GET /health'
        ? async () => {
            const gpu = await probeGpu(page)
            sendJson(res, 200, { ok: true, gpu, software: isSoftwareGpu(gpu), harnessUrl })
          }
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
      if (!res.headersSent) sendJson(res, 500, { error: e.message ?? String(e) })
      else res.destroy()
    })
  })

  await new Promise((resolve) => server.listen(port, resolve))
  console.log(`FreeCut render service on http://localhost:${port}  (workspace: ${workspace})`)
  console.log(`  GET /health  GET /projects  POST /render  POST /edit`)

  const shutdown = async () => {
    console.log('\nShutting down...')
    server.close()
    await browser.close()
    await closeServers()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  console.error('\nService failed to start:', e.message ?? e)
  process.exit(1)
})
