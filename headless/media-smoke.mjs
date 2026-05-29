// Phase 1b smoke test: render a real video clip (with audio) to MP4/H.264
// through the headless harness, validating media serving + blobUrlManager
// seeding + WebCodecs video decode + AAC audio encode.
//
// Prereq: dev server running on :5173; headless/assets/testclip.mp4 present.
// Run: node headless/media-smoke.mjs [--head]
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { createMediaServer } from './media-server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const HEADED = process.argv.includes('--head')
const HARNESS_URL = 'http://localhost:5173/headless.html'
const CLIP = path.join(ROOT, 'assets', 'testclip.mp4')

const MEDIA_ID = 'testclip'
const FPS = 30
const DURATION_FRAMES = 90 // 3s
const WIDTH = 1280
const HEIGHT = 720

const buildInput = (mediaUrl) => ({
  tracks: [
    {
      id: 'track-1',
      name: 'V1',
      kind: 'video',
      height: 60,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    },
    {
      id: 'track-2',
      name: 'A1',
      kind: 'audio',
      height: 60,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [],
    },
  ],
  items: [
    {
      id: 'vid-1',
      trackId: 'track-1',
      from: 0,
      durationInFrames: DURATION_FRAMES,
      label: 'testclip',
      type: 'video',
      mediaId: MEDIA_ID,
      sourceFps: FPS,
      sourceStart: 0,
      sourceEnd: DURATION_FRAMES,
      sourceDuration: DURATION_FRAMES,
      speed: 1,
      volume: 0,
      linkedGroupId: 'g1',
    },
    {
      // Linked audio companion (as the app creates on video import).
      id: 'aud-1',
      trackId: 'track-2',
      from: 0,
      durationInFrames: DURATION_FRAMES,
      label: 'testclip audio',
      type: 'audio',
      mediaId: MEDIA_ID,
      sourceFps: FPS,
      sourceStart: 0,
      sourceEnd: DURATION_FRAMES,
      sourceDuration: DURATION_FRAMES,
      speed: 1,
      volume: 0,
      linkedGroupId: 'g1',
    },
    {
      id: 'text-1',
      trackId: 'track-1',
      from: 15,
      durationInFrames: 60,
      label: 'caption',
      type: 'text',
      text: 'headless media',
      color: '#ffe600',
      fontSize: 90,
      fontWeight: 'bold',
      textAlign: 'center',
      verticalAlign: 'bottom',
    },
  ],
  transitions: [],
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#000000',
  media: [{ mediaId: MEDIA_ID, url: mediaUrl }],
  settings: {
    mode: 'video',
    codec: 'avc',
    audioCodec: 'aac',
    container: 'mp4',
    quality: 'high',
    resolution: { width: WIDTH, height: HEIGHT },
    fps: FPS,
    videoBitrate: 6_000_000,
    audioBitrate: 128_000,
  },
  outputFileName: 'media-smoke.mp4',
})

const main = async () => {
  if (!fs.existsSync(CLIP)) throw new Error(`Missing test clip: ${CLIP}`)
  const outPath = path.join(ROOT, 'output', 'media-smoke.mp4')

  const mediaServer = await createMediaServer(new Map([[MEDIA_ID, CLIP]]))
  const mediaUrl = mediaServer.url(MEDIA_ID)
  console.log(`Media server: ${mediaUrl}`)

  const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: chromeLaunchArgs() })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('console', (m) => {
      const t = m.text()
      if (m.type() === 'error' || /\[Headless\]|Audio|audio/.test(t)) {
        console.log(`  [page:${m.type()}]`, t)
      }
    })
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))

    let lastPct = -1
    await page.exposeBinding('__freecutProgress', (_src, progress) => {
      const pct = Math.floor(progress?.progress ?? 0)
      if (pct !== lastPct) {
        lastPct = pct
        process.stdout.write(`\r  ${progress?.phase ?? 'render'}: ${pct}%   `)
      }
    })

    await page.goto(HARNESS_URL, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    console.log('Harness ready. Rendering...')

    const downloadPromise = page.waitForEvent('download', { timeout: 300_000 })
    const summary = await page.evaluate(
      (renderInput) => window.freecut.renderTimeline(renderInput),
      buildInput(mediaUrl),
    )
    process.stdout.write('\n')
    console.log('Render summary:', summary)

    const download = await downloadPromise
    await download.saveAs(outPath)
    console.log(`Saved -> ${outPath}`)
  } finally {
    await browser.close()
    await mediaServer.close()
  }
}

main().catch((e) => {
  console.error('\nMEDIA SMOKE TEST FAILED:', e)
  process.exit(1)
})
