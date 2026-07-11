import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['server/studio-audio-server.mjs'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', ...process.argv.slice(2)], {
    stdio: 'inherit',
  }),
]

function stop(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop(signal)
    process.exit(0)
  })
}

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      stop()
      process.exitCode = code
    }
  })
}
