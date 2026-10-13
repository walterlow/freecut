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
        fontSize: 96,
        fontWeight: 'bold',
        textAlign: 'center',
        verticalAlign: 'middle',
        transform: {},
      },
    ],
    transitions: [],
    keyframes: [],
    compositions: [],
  },
}

function textProjectRenderSettings(project) {
  const width = project.metadata?.width ?? 1280
  const height = project.metadata?.height ?? 720
  const fps = project.metadata?.fps ?? 30

  return {
    mode: 'video',
    codec: 'vp9',
    container: 'webm',
    quality: 'medium',
    resolution: { width, height },
    fps,
    videoBitrate: 2_000_000,
  }
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
  // --skip-build reuses an existing dist/ (e.g. CI, where the build step
  // already ran); without it the harness always rebuilds.
  if (process.argv.includes('--skip-build')) {
    console.log('Skipping build (--skip-build), using existing dist/...')
  } else {
    console.log('Building harness (npm run build)...')
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
  }
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error(
      process.argv.includes('--skip-build')
        ? 'dist/headless.html missing — run npm run build first or drop --skip-build'
        : 'Build did not produce dist/headless.html',
    )
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-headless-regression-'))
  const probeSource = path.join(tempDir, 'probe.svg')
  fs.writeFileSync(
    probeSource,
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3"/></svg>',
  )
  const server = await createHarnessServer({
    distDir,
    resolveMedia: (id) => (id === 'probe-source' ? probeSource : null),
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('pageerror', (e) => {
      failures++
      console.error('  FAIL  page error —', e.message)
    })

    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    const probeContract = await page.evaluate(async (url) => {
      const originalBlob = Response.prototype.blob
      let blobCalled = false
      Response.prototype.blob = async function () {
        blobCalled = true
        throw new Error('response.blob must not be used')
      }
      try {
        const probe = await window.freecut.probeMedia({
          url,
          fileName: 'probe.svg',
          mimeType: 'image/svg+xml',
        })
        const root = await navigator.storage.getDirectory()
        const leftovers = []
        for await (const name of root.keys()) {
          if (name.startsWith('.freecut-probe-')) leftovers.push(name)
        }
        return { blobCalled, leftovers, mimeType: probe.mimeType }
      } finally {
        Response.prototype.blob = originalBlob
      }
    }, server.mediaUrl('probe-source'))
    check('media probe streams without response.blob', probeContract.blobCalled === false)
    check('media probe removes its OPFS temporary file', probeContract.leftovers.length === 0)
    check(
      'streaming media probe keeps authoritative MIME',
      probeContract.mimeType === 'image/svg+xml',
    )

    // --- Render path ---
    console.log('\nRender:')
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    downloadPromise.catch(() => {})
    const summary = await page.evaluate(
      (input) => window.freecut.renderTimeline(input),
      TEXT_TIMELINE,
    )
    const outPath = path.join(tempDir, 'render.webm')
    const download = await downloadPromise
    await download.saveAs(outPath)
    const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0

    check('render returns ok', summary.ok === true)
    check('render mime is video', /video\//.test(summary.mimeType), summary.mimeType)
    check('supported render reports effective codec', summary.effectiveSettings?.codec === 'vp9')
    check(
      'supported render has no codec fallback warning',
      !summary.warnings.some((w) => w.code === 'CODEC_FALLBACK'),
    )
    check(
      'render duration ~3s',
      Math.abs(summary.durationSeconds - 3) < 0.3,
      `got ${summary.durationSeconds}`,
    )
    check('render produced bytes (>1KB)', size > 1000, `size ${size}`)

    // Deterministic capability seam: force AVC to adapt to VP9 regardless of
    // the codecs installed on the CI host.
    console.log('\nForced codec fallback:')
    await page.evaluate(() => {
      globalThis.__freecutSupportedCodecsOverride = ['vp9']
    })
    const fallbackInput = structuredClone(TEXT_TIMELINE)
    fallbackInput.settings.codec = 'avc'
    fallbackInput.settings.container = 'mp4'
    fallbackInput.outputFileName = 'regression-fallback.mp4'
    const fallbackDownloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    fallbackDownloadPromise.catch(() => {})
    const fallbackSummary = await page.evaluate(
      (input) => window.freecut.renderTimeline(input),
      fallbackInput,
    )
    const fallbackOutPath = path.join(tempDir, 'fallback.webm')
    const fallbackDownload = await fallbackDownloadPromise
    await fallbackDownload.saveAs(fallbackOutPath)
    const fallbackSignature = fs.readFileSync(fallbackOutPath).subarray(0, 4).toString('hex')
    check(
      'fallback reports stable warning code',
      fallbackSummary.warnings.some((w) => w.code === 'CODEC_FALLBACK'),
    )
    check(
      'fallback reports effective VP9/WebM',
      fallbackSummary.effectiveSettings?.codec === 'vp9' &&
        fallbackSummary.effectiveSettings?.container === 'webm' &&
        fallbackSummary.effectiveSettings?.audioCodec === 'opus',
    )
    check(
      'fallback MIME matches effective WebM',
      fallbackSummary.mimeType.startsWith('video/webm'),
      fallbackSummary.mimeType,
    )
    check(
      'fallback filename matches effective WebM',
      fallbackSummary.fileName.endsWith('.webm'),
      fallbackSummary.fileName,
    )
    check('fallback bytes have WebM signature', fallbackSignature === '1a45dfa3', fallbackSignature)
    await page.evaluate(() => {
      delete globalThis.__freecutSupportedCodecsOverride
    })

    // --- Edit path ---
    console.log('\nEdit:')
    const edit = await page.evaluate((input) => window.freecut.editProject(input), {
      project: SAMPLE_PROJECT,
      ops: [
        {
          op: 'addText',
          id: 'caption-1',
          text: 'added',
          from: 30,
          durationInFrames: 45,
          color: '#7dd3fc',
          fontSize: 72,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        {
          op: 'setTransform',
          id: 'text-1',
          transform: { x: 24, y: -32, opacity: 0.85, rotation: 0 },
        },
        { op: 'addKeyframe', itemId: 'text-1', property: 'opacity', frame: 0, value: 0.2 },
        { op: 'addKeyframe', itemId: 'text-1', property: 'opacity', frame: 30, value: 1 },
      ],
    })
    check('edit applied all ops', edit.applied === 4)
    check('edit ops succeeded', edit.results?.every((result) => result.ok) === true)
    const before = SAMPLE_PROJECT.timeline.items.length
    const after = edit.project?.timeline?.items?.length ?? 0
    check('edit added an item', after === before + 1, `items ${before} -> ${after}`)

    const referencedEdit = await page.evaluate(
      (project) =>
        window.freecut.editProject({
          project,
          ops: [
            { callerId: 'created', op: 'addText', text: 'referenced', from: 0 },
            {
              callerId: 'moved',
              op: 'moveItem',
              id: { $ref: 'created#/detail/id' },
              from: 12,
            },
          ],
        }),
      SAMPLE_PROJECT,
    )
    const referencedId = referencedEdit.results?.[0]?.detail?.id
    check('caller result reference resolves generated id', Boolean(referencedId))
    check(
      'referenced operation moved the generated item',
      referencedEdit.project?.timeline?.items?.find((item) => item.id === referencedId)?.from ===
        12,
    )

    const missingTargetError = await page.evaluate(async (project) => {
      try {
        await window.freecut.editProject({
          project,
          ops: [{ op: 'updateItem', id: 'missing', updates: { label: 'nope' } }],
        })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, SAMPLE_PROJECT)
    check(
      'missing update target fails truthfully',
      /id: item "missing" does not exist/.test(missingTargetError ?? ''),
      missingTargetError,
    )

    const missingRemoveError = await page.evaluate(async (project) => {
      try {
        await window.freecut.editProject({
          project,
          ops: [{ op: 'removeItems', ids: ['text-1', 'missing'] }],
        })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, SAMPLE_PROJECT)
    check(
      'removeItems rejects a batch containing missing ids',
      /ids: item "missing" does not exist/.test(missingRemoveError ?? ''),
      missingRemoveError,
    )

    const reopenedProject = JSON.parse(JSON.stringify(edit.project))
    const items = reopenedProject.timeline?.items ?? []
    const keyframes = reopenedProject.timeline?.keyframes ?? []
    const expectedEditedDurationSeconds =
      Math.max(...items.map((item) => item.from + item.durationInFrames)) /
      (reopenedProject.metadata?.fps ?? 30)
    const movedTitle = items.find((item) => item.id === 'text-1')
    const addedCaption = items.find((item) => item.id === 'caption-1')
    const opacityKeys = keyframes
      .find((group) => group.itemId === 'text-1')
      ?.properties?.find((property) => property.property === 'opacity')?.keyframes

    check('round-trip preserves added caption', addedCaption?.text === 'added')
    check('round-trip preserves transform', movedTitle?.transform?.opacity === 0.85)
    check('round-trip preserves keyframes', opacityKeys?.length === 2)

    console.log('\nEdited project render:')
    const editedDownloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    editedDownloadPromise.catch(() => {})
    const editedSummary = await page.evaluate((input) => window.freecut.renderProject(input), {
      project: reopenedProject,
      settings: textProjectRenderSettings(reopenedProject),
      outputFileName: 'regression-edited.webm',
    })
    const editedOutPath = path.join(tempDir, 'edited.webm')
    const editedDownload = await editedDownloadPromise
    await editedDownload.saveAs(editedOutPath)
    const editedSize = fs.existsSync(editedOutPath) ? fs.statSync(editedOutPath).size : 0

    check('edited render returns ok', editedSummary.ok === true)
    check(
      'edited render mime is video',
      /video\//.test(editedSummary.mimeType),
      editedSummary.mimeType,
    )
    check(
      'edited render duration matches timeline',
      Math.abs(editedSummary.durationSeconds - expectedEditedDurationSeconds) < 0.3,
      `got ${editedSummary.durationSeconds}, expected ${expectedEditedDurationSeconds}`,
    )
    check('edited render produced bytes (>1KB)', editedSize > 1000, `size ${editedSize}`)

    console.log('\nFrame grab + layout dump:')
    const frameDownloadPromise = page.waitForEvent('download', { timeout: 60_000 })
    frameDownloadPromise.catch(() => {})
    const frameSummary = await page.evaluate((input) => window.freecut.renderFrame(input), {
      project: reopenedProject,
      atSeconds: 1,
    })
    const framePath = path.join(tempDir, 'frame.png')
    const frameDownload = await frameDownloadPromise
    await frameDownload.saveAs(framePath)
    const frameSize = fs.existsSync(framePath) ? fs.statSync(framePath).size : 0
    check('frame grab returns ok', frameSummary.ok === true)
    check(
      'frame grab matches project resolution',
      frameSummary.width === (reopenedProject.metadata?.width ?? -1),
      `got ${frameSummary.width}`,
    )
    check('frame PNG has real pixels (>10KB)', frameSize > 10_000, `size ${frameSize}`)

    const layout = await page.evaluate((input) => window.freecut.dumpLayout(input), {
      project: reopenedProject,
      atSeconds: 1,
    })
    const titleBox = layout.items.find((box) => box.id === 'text-1')
    check('layout reports the title box', Boolean(titleBox))
    check(
      'layout title is visible with sane bounds',
      Boolean(titleBox && titleBox.visible && titleBox.width > 0 && titleBox.height > 0),
      titleBox ? `${titleBox.width}x${titleBox.height}` : 'missing',
    )
    check('layout carries a validation warnings array', Array.isArray(layout.warnings))

    // textLayout: real measured geometry (lines + inline-span runs) for text items.
    const tl = titleBox?.textLayout
    check('layout exposes textLayout for text items', Boolean(tl && tl.lines.length >= 1))
    check(
      'textLayout line has positive width within the box',
      Boolean(
        tl &&
        tl.lines.every(
          (line) => line.width > 0 && line.inkWidth > 0 && line.width <= tl.box.width + 0.5,
        ),
      ),
      tl ? JSON.stringify(tl.lines.map((line) => line.width)) : 'missing',
    )
    check(
      'textLayout baseline sits inside the box',
      Boolean(
        tl &&
        tl.lines.every(
          (line) => line.baseline > tl.box.y && line.baseline <= tl.box.y + tl.box.height,
        ),
      ),
    )

    const spanProject = JSON.parse(JSON.stringify(reopenedProject))
    const spanTrack = {
      ...spanProject.timeline.tracks[0],
      id: 'track-spans',
      name: 'Spans',
      order: Math.min(...spanProject.timeline.tracks.map((track) => track.order)) - 1,
    }
    spanProject.timeline.tracks.push(spanTrack)
    spanProject.timeline.items.push({
      ...spanProject.timeline.items.find((item) => item.id === 'text-1'),
      id: 'text-spans',
      trackId: 'track-spans',
      text: 'до КЛЮЧ после',
      textSpans: [{ text: 'до ' }, { text: 'КЛЮЧ', color: '#FF7A00' }, { text: ' после' }],
      spanLayout: 'inline',
      from: 0,
      durationInFrames: 60,
    })
    const spanLayoutDump = await page.evaluate((input) => window.freecut.dumpLayout(input), {
      project: spanProject,
      frame: 1,
    })
    const spanBox = spanLayoutDump.items.find((box) => box.id === 'text-spans')
    check('span item present in layout dump', Boolean(spanBox), spanBox ? 'ok' : 'item missing')
    const spanRuns = spanBox?.textLayout?.lines?.[0]?.spans
    check('inline spanLayout yields per-span runs', Boolean(spanRuns && spanRuns.length === 3))
    check(
      'span runs advance left-to-right with positive widths',
      Boolean(
        spanRuns &&
        spanRuns.every((run) => run.width > 0) &&
        spanRuns[1].x > spanRuns[0].x &&
        spanRuns[2].x > spanRuns[1].x,
      ),
      spanRuns
        ? JSON.stringify(spanRuns.map((run) => [Math.round(run.x), Math.round(run.width)]))
        : 'missing',
    )

    // --strict must fail BEFORE rendering on silent-failure findings.
    const brokenProject = JSON.parse(JSON.stringify(reopenedProject))
    brokenProject.timeline.items.push({
      ...brokenProject.timeline.items.find((item) => item.id === 'text-1'),
      id: 'text-overlap',
    })
    const strictError = await page.evaluate(
      async (input) => {
        try {
          await window.freecut.dumpLayout(input)
          return null
        } catch (error) {
          return String(error?.message ?? error)
        }
      },
      { project: brokenProject, strict: true },
    )
    check(
      'strict mode rejects a project with overlapping items',
      Boolean(strictError && strictError.includes('TRACK_OVERLAP_REPAIRED')),
      strictError ?? 'no error thrown',
    )
  } finally {
    await browser.close()
    await server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
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
