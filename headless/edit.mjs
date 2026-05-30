// FreeCut headless edit CLI.
//
// Applies a list of edit ops to a project by driving the real timeline action
// modules inside headless Chrome (via window.freecut.editProject), then writes
// the edited project back out. No rendering, no media needed.
//
// Usage:
//   node headless/edit.mjs --workspace <dir> --project <id|project.json> --ops <ops.json> [--out <path> | --in-place]
//
// Options:
//   --ops <file.json>   JSON file with an array of edit ops (or a single op object)
//   --out <path>        Write the edited project JSON here
//   --in-place          Overwrite the source project.json (destructive — explicit opt-in)
//   --build             Build dist/ first if the harness isn't built
//   --harness-url <url> Dev mode: drive a running Vite dev server instead of dist/
//   --head              Run headed (visible browser) for debugging
//
// With neither --out nor --in-place this is a DRY RUN: it applies the ops and
// prints the result summary without writing anything.
//
// Ops (JSON): each is { "op": "<name>", ... }
//   addText      { text, from, durationInFrames, trackId?, color?, fontSize?, fontWeight?, textAlign?, verticalAlign? }
//   addItem      { item: <full TimelineItem> }
//   updateItem   { id, updates: <partial TimelineItem> }
//   moveItem     { id, from, trackId? }
//   removeItems  { ids: [<id>...] }
//   split        { id, frame }
//   trimStart    { id, amount }
//   trimEnd      { id, amount }
//   addTransition{ leftClipId, rightClipId, type?, durationInFrames? }
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { loadProject, collectAddClipMedia } from './lib/workspace.mjs'
import { parseArgs } from './lib/cli.mjs'
import { startHarness } from './lib/render-core.mjs'

function loadOps(args) {
  if (!args.ops) throw new Error('Missing --ops <file.json>')
  const opsPath = path.resolve(args.ops)
  if (!fs.existsSync(opsPath)) throw new Error(`Ops file not found: ${opsPath}`)
  const parsed = JSON.parse(fs.readFileSync(opsPath, 'utf8'))
  const ops = Array.isArray(parsed) ? parsed : [parsed]
  if (ops.length === 0) throw new Error('Ops file is empty')
  return ops
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workspace) throw new Error('Missing --workspace <dir>')
  if (!args.project) throw new Error('Missing --project <id|project.json>')

  const ops = loadOps(args)
  const { project, projectJsonPath } = loadProject(args.workspace, args.project)
  console.log(`Project: ${project.name ?? project.id} (${projectJsonPath})`)
  console.log(`Ops: ${ops.length}`)

  // Collect metadata for media referenced by addClip ops (for duration/fps/codec).
  const media = collectAddClipMedia(args.workspace, ops)
  const missingMeta = media.filter((m) => !m.metadata).map((m) => m.mediaId)
  if (missingMeta.length > 0) {
    throw new Error(`addClip media not found in workspace: ${missingMeta.join(', ')}`)
  }

  // Edit needs no media serving (no rendering) — omit workspace.
  const { harnessUrl, closeServers } = await startHarness({
    devUrl: args['harness-url'],
    build: args.build,
  })
  const browser = await chromium.launch({ channel: 'chrome', headless: !args.head })
  let result
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) {
        console.error('  [page:error]', m.text())
      }
    })
    await page.goto(harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    result = await page.evaluate((payload) => window.freecut.editProject(payload), {
      project,
      ops,
      media,
    })
  } finally {
    await browser.close()
    await closeServers()
  }

  console.log('\nApplied ops:')
  for (const r of result.results) {
    console.log(`  ${r.ok ? 'ok ' : 'ERR'} ${r.op}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`)
  }
  const edited = result.project
  const itemCount = edited.timeline?.items?.length ?? 0
  console.log(`Result: ${itemCount} items, ${edited.timeline?.tracks?.length ?? 0} tracks`)

  // Write back (safe by default: dry run unless --out or --in-place).
  let outPath = null
  if (args.out) outPath = path.resolve(args.out)
  else if (args['in-place']) outPath = projectJsonPath

  if (!outPath) {
    console.log('\nDRY RUN (no --out / --in-place): nothing written.')
    return
  }

  const toWrite = { ...edited, updatedAt: Date.now() }
  fs.writeFileSync(outPath, JSON.stringify(toWrite, null, 2))
  console.log(`\nWrote: ${outPath}`)
}

main().catch((e) => {
  console.error('\nEdit failed:', e.message ?? e)
  process.exit(1)
})
