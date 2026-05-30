// Headless regression test. Builds the harness, then exercises both the render
// and edit paths inside headless Chrome and asserts the results. Self-contained:
// no workspace, no media, no ffprobe — so it runs in CI. Exits non-zero on any
// failed check.
//
// Run: node headless/test.mjs   (or: npm run headless:test)
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// A zero-media text title — no effects/transitions, so it renders without WebGPU.
const TEXT_TIMELINE = {
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
      text: 'regression',
      color: '#ffffff',
      fontSize: 120,
      fontWeight: 'bold',
      textAlign: 'center',
      verticalAlign: 'middle',
    },
  ],
  transitions: [],
  fps: 30,
  width: 1280,
  height: 720,
  backgroundColor: '#101418',
  settings: {
    mode: 'video',
    codec: 'vp9',
    container: 'webm',
    quality: 'high',
    resolution: { width: 1280, height: 720 },
    fps: 30,
    videoBitrate: 4_000_000,
  },
  outputFileName: 'regression.webm',
}

const SAMPLE_PROJECT = {
  id: 'test-project',
  name: 'Test',
  description: '',
  createdAt: 1735689600000,
  updatedAt: 1735689600000,
  duration: 90,
  schemaVersion: 10,
  metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
  timeline: {
    masterBusDb: 0,
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
        text: 'hello',
        color: '#ffffff',
      },
    ],
    transitions: [],
    keyframes: [],
    compositions: [],
  },
}

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const distDir = path.join(REPO_ROOT, 'dist')
  console.log('Building harness (npm run build)...')
  execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('Build did not produce dist/headless.html')
  }

  const server = await createHarnessServer({ distDir })
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: chromeLaunchArgs() })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('pageerror', (e) => {
      failures++
      console.error('  FAIL  page error —', e.message)
    })

    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    // --- Render path ---
    console.log('\nRender:')
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    downloadPromise.catch(() => {})
    const summary = await page.evaluate((input) => window.freecut.renderTimeline(input), TEXT_TIMELINE)
    const outPath = path.join(os.tmpdir(), 'freecut-headless-regression.webm')
    const download = await downloadPromise
    await download.saveAs(outPath)
    const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0

    check('render returns ok', summary.ok === true)
    check('render mime is video', /video\//.test(summary.mimeType), summary.mimeType)
    check('render duration ~3s', Math.abs(summary.durationSeconds - 3) < 0.3, `got ${summary.durationSeconds}`)
    check('render produced bytes (>1KB)', size > 1000, `size ${size}`)

    // --- Edit path ---
    console.log('\nEdit:')
    const edit = await page.evaluate((input) => window.freecut.editProject(input), {
      project: SAMPLE_PROJECT,
      ops: [{ op: 'addText', text: 'added', from: 0, durationInFrames: 30 }],
    })
    check('edit applied 1 op', edit.applied === 1)
    check('edit op succeeded', edit.results?.[0]?.ok === true)
    const before = SAMPLE_PROJECT.timeline.items.length
    const after = edit.project?.timeline?.items?.length ?? 0
    check('edit added an item', after === before + 1, `items ${before} -> ${after}`)
  } finally {
    await browser.close()
    await server.close()
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll headless checks passed ✓')
}

main().catch((e) => {
  console.error('\nTest crashed:', e.message ?? e)
  process.exit(1)
})
