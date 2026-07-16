import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildProjectSnapshot, persistEditedProject } from './lib/workspace.mjs'

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

test('direct in-place persistence refuses to update index without the writer lock invariant', (t) => {
  const value = fixture()
  t.after(() => fs.rmSync(value.workspace, { recursive: true, force: true }))

  assert.throws(
    () => persistEditedProject(value.workspace, value.projectPath, value.project),
    /requires the workspace writer lock/,
  )
})
