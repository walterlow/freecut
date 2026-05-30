// Shared headless render core used by the render CLI (render.mjs) and the
// render service (serve.mjs): settings, range, media resolution, the
// harness/media servers, and the per-page render call.
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { loadProject, collectMediaIds, resolveMediaFiles, resolveMediaFile, readMediaMetadata } from './workspace.mjs'
import { createMediaServer } from '../media-server.mjs'
import { createHarnessServer } from '../server.mjs'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const CODEC_MAP = { h264: 'avc', avc: 'avc', h265: 'hevc', hevc: 'hevc', vp9: 'vp9', vp8: 'vp8', av1: 'av1' }
const DEFAULT_CONTAINER = { avc: 'mp4', hevc: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'webm' }
const VIDEO_BITRATE_BY_QUALITY = { low: 2_500_000, medium: 5_000_000, high: 10_000_000, ultra: 20_000_000 }

/** Build ClientExportSettings from a job's options (same keys as the CLI flags). */
export function buildSettings(project, opts) {
  const meta = project.metadata ?? {}
  const fps = opts.fps ? Number(opts.fps) : (meta.fps ?? 30)
  let width = meta.width ?? 1920
  let height = meta.height ?? 1080
  if (opts.resolution) {
    const m = /^(\d+)x(\d+)$/.exec(opts.resolution)
    if (!m) throw new Error(`Invalid resolution "${opts.resolution}" (expected WxH, e.g. 1920x1080)`)
    width = Number(m[1])
    height = Number(m[2])
  }
  const quality = opts.quality ?? 'high'

  if (opts['audio-only'] || opts.audioOnly) {
    const container = opts.container ?? 'mp3'
    return {
      mode: 'audio',
      codec: 'avc',
      audioCodec: container === 'mp3' ? 'mp3' : container === 'wav' ? 'pcm-s16' : 'aac',
      container,
      quality,
      resolution: { width, height },
      fps,
      audioBitrate: 192_000,
    }
  }

  const codecInput = (opts.codec ?? 'h264').toLowerCase()
  const codec = CODEC_MAP[codecInput]
  if (!codec) throw new Error(`Unknown codec "${opts.codec}" (use h264|h265|vp9|vp8|av1)`)
  const container = opts.container ?? DEFAULT_CONTAINER[codec]
  return {
    mode: 'video',
    codec,
    audioCodec: container === 'webm' ? 'opus' : 'aac',
    container,
    quality,
    resolution: { width, height },
    fps,
    videoBitrate: VIDEO_BITRATE_BY_QUALITY[quality] ?? 10_000_000,
    audioBitrate: 192_000,
  }
}

/** Compute the render range (frames) from a job's in/out-sec/duration (seconds). */
export function computeRange(opts, fps) {
  const inV = opts.in ?? opts.inSec
  const outV = opts['out-sec'] ?? opts.outSec
  const hasRange = inV !== undefined || outV !== undefined || opts.duration !== undefined
  if (!hasRange) return { hasRange: false, inPoint: null, outPoint: null }
  const inSec = inV !== undefined ? Number(inV) : 0
  const outSec =
    outV !== undefined ? Number(outV) : opts.duration !== undefined ? inSec + Number(opts.duration) : undefined
  return {
    hasRange: true,
    inPoint: Math.round(inSec * fps),
    outPoint: outSec !== undefined ? Math.round(outSec * fps) : null,
  }
}

async function ensureHarnessReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (res.ok) return
  } catch {
    // fall through
  }
  throw new Error(`Dev harness not reachable at ${url}. Start it with: npm run dev`)
}

/**
 * Start the harness + media servers (media resolved dynamically from the
 * workspace). Default: standalone server over built dist/. devUrl: drive a
 * running Vite dev server + cross-origin media server. Omit `workspace` for the
 * edit path (no rendering): no media server is started and `mediaUrlOf` is a
 * no-op.
 */
export async function startHarness({ workspace, devUrl, build }) {
  const resolveMedia = workspace ? (mediaId) => resolveMediaFile(workspace, mediaId) : undefined
  if (devUrl) {
    await ensureHarnessReachable(devUrl)
    if (!resolveMedia) return { harnessUrl: devUrl, mediaUrlOf: () => undefined, closeServers: async () => {} }
    const mediaServer = await createMediaServer(resolveMedia)
    return { harnessUrl: devUrl, mediaUrlOf: (id) => mediaServer.url(id), closeServers: () => mediaServer.close() }
  }
  const distDir = path.join(REPO_ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    if (build) {
      execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
    } else {
      throw new Error(
        'Harness not built: dist/headless.html is missing. Run `npm run build` (or pass build:true / --build).',
      )
    }
  }
  const server = await createHarnessServer({ distDir, resolveMedia })
  return { harnessUrl: server.harnessUrl, mediaUrlOf: (id) => server.mediaUrl(id), closeServers: () => server.close() }
}

/** Resolve everything needed to render one job (no browser involved). */
export function prepareJob(workspace, jobArgs, mediaUrlOf) {
  if (!jobArgs.project && !jobArgs.projectObject) throw new Error('Job missing "project"')
  const { project, projectJsonPath } = jobArgs.projectObject
    ? { project: jobArgs.projectObject, projectJsonPath: '(inline)' }
    : loadProject(workspace, jobArgs.project)
  const settings = buildSettings(project, jobArgs)
  const { hasRange, inPoint, outPoint } = computeRange(jobArgs, settings.fps)

  const mediaIds = collectMediaIds(
    project,
    hasRange ? { inFrame: inPoint ?? 0, outFrame: outPoint ?? Number.POSITIVE_INFINITY } : null,
  )
  const { files, missing } = resolveMediaFiles(workspace, mediaIds)
  const media = [...files.keys()].map((id) => ({
    mediaId: id,
    url: mediaUrlOf(id),
    metadata: readMediaMetadata(workspace, id) ?? undefined,
  }))

  const outName = `${(project.name ?? 'freecut-export').replace(/[^\w.-]+/g, '_')}.${settings.container}`
  const outPath = path.resolve(jobArgs.out ?? path.join('headless', 'output', outName))

  return {
    project,
    projectJsonPath,
    settings,
    hasRange,
    inPoint,
    outPoint,
    media,
    missing,
    mediaResolved: files.size,
    mediaTotal: mediaIds.length,
    outPath,
  }
}

/** Render one prepared job through an already-loaded harness page; saves to job.outPath. */
export async function renderJob(page, job, { setProgressLabel, onWarn } = {}) {
  fs.mkdirSync(path.dirname(job.outPath), { recursive: true })
  const warn = onWarn ?? ((m) => console.warn(m))
  if (job.missing.length > 0) {
    warn(`  WARNING: ${job.missing.length} media source(s) not found on disk: ${job.missing.join(', ')}`)
  }
  const unsupportedAudio = job.media.filter((m) => m.metadata?.audioCodecSupported === false)
  if (unsupportedAudio.length > 0) {
    const list = unsupportedAudio
      .map((m) => `${m.metadata.fileName ?? m.mediaId} (${m.metadata.audioCodec ?? 'unknown'})`)
      .join(', ')
    warn(`  WARNING: audio may be silent (codec not decodable headlessly): ${list}`)
  }

  setProgressLabel?.(path.basename(job.outPath))
  const downloadPromise = page.waitForEvent('download', { timeout: 30 * 60_000 })
  downloadPromise.catch(() => {})
  const summary = await page.evaluate((payload) => window.freecut.renderProject(payload), {
    project: job.project,
    settings: job.settings,
    media: job.media,
    renderWholeProject: !job.hasRange,
    inPoint: job.inPoint,
    outPoint: job.outPoint,
  })
  const download = await downloadPromise
  await download.saveAs(job.outPath)
  for (const w of summary.warnings ?? []) warn(`  WARNING: ${w}`)
  return summary
}
