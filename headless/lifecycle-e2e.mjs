import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-lifecycle-e2e-'))
const port = 20_000 + Math.floor(Math.random() * 20_000)

function generateToneWav(filePath) {
  const sampleRate = 48_000
  const sampleCount = sampleRate / 2
  const dataSize = sampleCount * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  for (let index = 0; index < sampleCount; index++)
    wav.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000),
      44 + index * 2,
    )
  fs.writeFileSync(filePath, wav)
}

async function jsonRequest(route, options) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options)
  const body = await response.json()
  assert.equal(response.ok, true, JSON.stringify(body))
  return { response, body }
}

function runAgent(args) {
  const result = spawnSync(process.execPath, ['headless/agent.mjs', ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const service = spawn(
  process.execPath,
  ['headless/serve.mjs', '--workspace', workspace, '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serviceLog = ''
service.stdout.on('data', (chunk) => {
  serviceLog += chunk
})
service.stderr.on('data', (chunk) => {
  serviceLog += chunk
})

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      ready = (await jsonRequest('/health')).body.ok
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  assert.equal(ready, true, serviceLog)
  const missingEvents = await fetch(
    `http://127.0.0.1:${port}/v1/events?projectId=missing-project`,
  )
  assert.equal(missingEvents.status, 404)
  assert.equal((await missingEvents.json()).error.code, 'PROJECT_NOT_FOUND')
  const createOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'create-demo' },
    body: JSON.stringify({ id: 'demo', name: 'Demo' }),
  }
  const created = (await jsonRequest('/v1/projects', createOptions)).body
  const replay = await jsonRequest('/v1/projects', createOptions)
  assert.equal(replay.response.headers.get('idempotency-replayed'), 'true')
  assert.equal(replay.body.revision, created.revision)
  const conflict = await fetch(`http://127.0.0.1:${port}/v1/projects`, {
    ...createOptions,
    body: '{ "id": "demo", "name": "Demo" }',
  })
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT')
  const listed = (await jsonRequest('/v1/projects')).body
  assert.equal(listed.projects.length, 1)
  const editOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'edit-demo' },
    body: JSON.stringify({
      persist: true,
      expectedRevision: created.revision,
      ops: [
        { callerId: 'created', op: 'addText', text: 'agent', from: 0 },
        { callerId: 'moved', op: 'moveItem', id: { $ref: 'created#/detail/id' }, from: 6 },
      ],
    }),
  }
  const edited = (await jsonRequest('/v1/projects/demo/edit', editOptions)).body
  assert.equal(edited.persisted, true)
  assert.equal(edited.project.timeline.items[0].from, 6)
} finally {
  const exited = new Promise((resolve) => service.once('exit', () => resolve(true)))
  service.kill('SIGTERM')
  const didExit = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ])
  assert.equal(didExit, true, 'service did not exit after SIGTERM')
  // Windows TerminateProcess does not run Node exit hooks. The test owns this
  // workspace and has confirmed the writer PID exited, so its lock is stale.
  fs.rmSync(path.join(workspace, '.freecut-headless', 'writer.lock'), { force: true })
}

try {
  const source = path.join(workspace, 'tone.wav')
  const output = path.join(workspace, 'rendered.wav')
  const ops = path.join(workspace, 'add-tone.json')
  generateToneWav(source)
  fs.writeFileSync(
    ops,
    JSON.stringify([
      { callerId: 'tone', op: 'addClip', mediaId: 'tone_1', from: 0, durationInFrames: 15 },
    ]),
  )
  const imported = runAgent([
    'media',
    'import',
    '--workspace',
    workspace,
    '--file',
    source,
    '--id',
    'tone_1',
    '--project',
    'demo',
  ])
  assert.equal(imported.media.metadata.mimeType, 'audio/wav')
  const current = runAgent(['project', 'get', '--workspace', workspace, '--id', 'demo'])
  const edited = runAgent([
    'project',
    'edit',
    '--workspace',
    workspace,
    '--id',
    'demo',
    '--ops',
    ops,
    '--persist',
    '--expected-revision',
    current.revision,
  ])
  assert.equal(edited.persisted, true)
  const rendered = runAgent([
    'render',
    '--workspace',
    workspace,
    '--project',
    'demo',
    '--out',
    output,
    '--audio-only',
    '--container',
    'wav',
    '--duration',
    '0.5',
  ])
  assert.equal(rendered.ok, true)
  assert.ok(fs.statSync(output).size > 1_000)
  console.log('Lifecycle HTTP + CLI import/edit/render checks passed')
} finally {
  fs.rmSync(workspace, { recursive: true, force: true })
}
