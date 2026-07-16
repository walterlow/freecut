import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildProjectSnapshot,
  persistEditedProject,
  reconcileProjectMediaLinksAfterCommit,
} from './lib/workspace.mjs'

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-workspace-live-sync-'))
  const projectDir = path.join(workspace, 'projects', 'p1')
  fs.mkdirSync(projectDir, { recursive: true })
  const project = {
    id: 'p1',
    name: 'Snapshot',
    createdAt: 1,
    updatedAt: 1,
    metadata: { width: 1280, height: 720, fps: 30 },
    timeline: { tracks: [], items: [] },
  }
  const projectText = `${JSON.stringify(project, null, 2)}\n`
  const projectPath = path.join(projectDir, 'project.json')
  fs.writeFileSync(projectPath, projectText)
  fs.writeFileSync(
    path.join(projectDir, 'media-links.json'),
    `${JSON.stringify({ version: '1.0', mediaIds: [] }, null, 2)}\n`,
  )
  return { workspace, project, projectPath, projectText }
}

test('snapshot project and project revision come from the same file read', (t) => {
  const value = fixture()
  t.after(() => fs.rmSync(value.workspace, { recursive: true, force: true }))

  const snapshot = buildProjectSnapshot(value.workspace, 'p1')

  assert.deepEqual(snapshot.project, value.project)
  assert.equal(
    snapshot.projectRevision,
    `sha256:${crypto.createHash('sha256').update(value.projectText).digest('hex')}`,
  )
})

test('snapshot revision hashes the same captured payloads it returns', (t) => {
  const value = fixture()
  const mediaDir = path.join(value.workspace, 'media', 'm1')
  fs.mkdirSync(mediaDir, { recursive: true })
  const metadataPath = path.join(mediaDir, 'metadata.json')
  const linksPath = path.join(value.workspace, 'projects', 'p1', 'media-links.json')
  const metadataText = `${JSON.stringify({
    id: 'm1',
    name: 'Clip',
    type: 'image',
    mimeType: 'image/png',
  })}\n`
  fs.writeFileSync(metadataPath, metadataText)
  fs.writeFileSync(path.join(mediaDir, 'clip.png'), 'image')
  const linksText = `${JSON.stringify({
    version: '1.0',
    mediaIds: [{ id: 'm1', addedAt: 1 }],
  })}\n`
  fs.writeFileSync(linksPath, linksText)
  t.after(() => fs.rmSync(value.workspace, { recursive: true, force: true }))

  const snapshot = buildProjectSnapshot(value.workspace, 'p1')

  assert.equal(snapshot.media.length, 1)
  assert.deepEqual(snapshot.media[0].metadata, JSON.parse(metadataText))
  assert.equal(
    snapshot.media[0].metadataFingerprint,
    `sha256:${crypto.createHash('sha256').update(metadataText).digest('hex')}`,
  )
  assert.equal(
    snapshot.revision,
    `sha256:${crypto
      .createHash('sha256')
      .update(value.projectText)
      .update('\0')
      .update(linksText)
      .update('\0')
      .update(`m1:${snapshot.media[0].fingerprint}`)
      .digest('hex')}`,
  )
})

test('direct in-place persistence refuses to update index without the writer lock invariant', (t) => {
  const value = fixture()
  t.after(() => fs.rmSync(value.workspace, { recursive: true, force: true }))

  assert.throws(
    () => persistEditedProject(value.workspace, value.projectPath, value.project),
    /requires the workspace writer lock/,
  )
})

test('post-commit media-link repair reports a warning instead of failing the saved project', (t) => {
  const value = fixture()
  const linksPath = path.join(value.workspace, 'projects', 'p1', 'media-links.json')
  fs.rmSync(linksPath)
  fs.mkdirSync(linksPath)
  t.after(() => fs.rmSync(value.workspace, { recursive: true, force: true }))

  const warnings = reconcileProjectMediaLinksAfterCommit(
    value.workspace,
    {
      ...value.project,
      timeline: {
        tracks: [],
        items: [
          {
            id: 'i1',
            type: 'image',
            trackId: 'v1',
            mediaId: 'm1',
            from: 0,
            durationInFrames: 1,
          },
        ],
      },
    },
    'p1',
  )

  assert.deepEqual(warnings, ['MEDIA_LINKS_REPAIR_REQUIRED'])
})
