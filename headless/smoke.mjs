// Phase 1 smoke test: render a zero-media text title to WebM through the
// headless harness, proving the full Playwright -> harness -> render ->
// download-capture loop end to end. No workspace or media serving required.
//
// Prereq: dev server running with COEP headers (npm run dev) on :5173.
// Run: node headless/smoke.mjs [--url http://localhost:5173/headless.html] [--head]
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromeLaunchArgs } from './lib/cli.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const HEADED = process.argv.includes('--head')
const urlArg = process.argv.indexOf('--url')
const HARNESS_URL =
  urlArg !== -1 ? process.argv[urlArg + 1] : 'http://localhost:5173/headless.html'

const input = {
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
  ],
  items: [
    {
      id: 'text-1',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      type: 'text',
      text: 'Hello Headless',
      color: '#ffffff',
      fontSize: 140,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      textAlign: 'center',
      verticalAlign: 'middle',
    },
  ],
  transitions: [],
  fps: 30,
  width: 1920,
  height: 1080,
  backgroundColor: '#101418',
  settings: {
    mode: 'video',
    codec: 'vp9',
    container: 'webm',
    quality: 'high',
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    videoBitrate: 8_000_000,
  },
  outputFileName: 'smoke.webm',
}

const main = async () => {
  const outPath = path.join(ROOT, 'output', 'smoke.webm')
  console.log(`Launching Chrome (headless=${!HEADED}) -> ${HARNESS_URL}`)
  const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: chromeLaunchArgs() })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('console', (m) => console.log(`  [page:${m.type()}]`, m.text()))
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))

    await page.exposeBinding('__freecutProgress', (_src, progress) => {
      const pct = typeof progress?.progress === 'number' ? progress.progress.toFixed(0) : '?'
      const frame = progress?.currentFrame ?? '?'
      const total = progress?.totalFrames ?? '?'
      process.stdout.write(`\r  ${progress?.phase ?? 'render'}: ${pct}% (frame ${frame}/${total})   `)
    })

    await page.goto(HARNESS_URL, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    console.log('Harness ready. Rendering...')

    const downloadPromise = page.waitForEvent('download', { timeout: 300_000 })
    const summary = await page.evaluate((renderInput) => window.freecut.renderTimeline(renderInput), input)
    process.stdout.write('\n')
    console.log('Render summary:', summary)

    const download = await downloadPromise
    await download.saveAs(outPath)
    console.log(`Saved -> ${outPath}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('\nSMOKE TEST FAILED:', e)
  process.exit(1)
})
