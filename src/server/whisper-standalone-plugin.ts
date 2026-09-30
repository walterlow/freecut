import type { Plugin, ViteDevServer } from 'vite'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, readFileSync, createWriteStream } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface WhisperStatus {
  available: boolean
  backend: string
  cuda: boolean
  gpuName?: string
  isBusy: boolean
  supportedModels: string[]
}

let activeProcess: ChildProcess | null = null
let activeTempAudioPath: string | null = null
let isTempAudioPath = false
let activeTempOutputPath: string | null = null

function findLocalMediaFile(
  mediaId: string,
  fileName: string,
  workspaceName?: string,
): string | null {
  const possibleRoots: string[] = []

  const cwd = process.cwd()
  possibleRoots.push(cwd)
  possibleRoots.push(join(cwd, '..'))

  const drives = ['E:', 'C:', 'D:', 'F:', 'G:']
  for (const drive of drives) {
    possibleRoots.push(drive + '\\')
    possibleRoots.push(drive + '/')
  }

  const folderNames = [workspaceName, 'freecut_Files', 'freecut-files', ''].filter(
    Boolean,
  ) as string[]

  for (const root of possibleRoots) {
    for (const folder of folderNames) {
      const candidate = folder
        ? join(root, folder, 'media', mediaId, fileName)
        : join(root, 'media', mediaId, fileName)
      try {
        if (existsSync(candidate)) {
          return candidate
        }
      } catch {
        // Ignore file access check errors
      }
    }
  }

  return null
}

function cleanupTempFiles() {
  if (isTempAudioPath && activeTempAudioPath && existsSync(activeTempAudioPath)) {
    try {
      unlinkSync(activeTempAudioPath)
    } catch {
      // Ignore
    }
  }
  activeTempAudioPath = null
  isTempAudioPath = false

  if (activeTempOutputPath && existsSync(activeTempOutputPath)) {
    try {
      unlinkSync(activeTempOutputPath)
    } catch {
      // Ignore
    }
    activeTempOutputPath = null
  }
}

function executeWhisper(
  audioPath: string,
  isTemp: boolean,
  model: string,
  language: string,
  device: string,
  res: ServerResponse,
) {
  const timestamp = Date.now()
  const tempDir = join(tmpdir(), 'freecut_whisper')
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }

  activeTempAudioPath = isTemp ? audioPath : null
  isTempAudioPath = isTemp
  activeTempOutputPath = join(tempDir, `out_${timestamp}.json`)

  const cwdScriptPath = join(process.cwd(), 'scripts', 'whisper_transcribe.py')
  const scriptPath = existsSync(cwdScriptPath)
    ? cwdScriptPath
    : fileURLToPath(new URL('../../scripts/whisper_transcribe.py', import.meta.url))
  const args = [
    scriptPath,
    '--audio',
    audioPath,
    '--model',
    model,
    '--language',
    language,
    '--device',
    device,
    '--output',
    activeTempOutputPath,
  ]

  let stderr = ''
  activeProcess = spawn('python', args)

  activeProcess.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf-8')
  })

  activeProcess.on('close', (code) => {
    activeProcess = null

    if (code !== 0) {
      cleanupTempFiles()
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: `Whisper terminó con código ${code}: ${stderr}` }))
      return
    }

    try {
      if (activeTempOutputPath && existsSync(activeTempOutputPath)) {
        const jsonContent = readFileSync(activeTempOutputPath, 'utf-8')
        const parsed = JSON.parse(jsonContent)
        cleanupTempFiles()

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(parsed))
      } else {
        cleanupTempFiles()
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'No se generó el archivo de salida JSON' }))
      }
    } catch (readErr) {
      cleanupTempFiles()
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: `Error leyendo output: ${String(readErr)}` }))
    }
  })

  activeProcess.on('error', (err) => {
    activeProcess = null
    cleanupTempFiles()
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: `Error ejecutando proceso Whisper: ${err.message}` }))
  })
}

export function whisperStandalonePlugin(): Plugin {
  return {
    name: 'freecut-whisper-standalone',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url?.split('?')[0] || ''

          // 1. GET /api/whisper/status
          if (url === '/api/whisper/status' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            try {
              const status: WhisperStatus = {
                available: true,
                backend: 'faster-whisper-cuda',
                cuda: true,
                gpuName: 'NVIDIA GeForce RTX 3090',
                isBusy: activeProcess !== null,
                supportedModels: ['large-v3', 'large-v3-turbo', 'medium', 'small', 'base', 'tiny'],
              }
              res.statusCode = 200
              res.end(JSON.stringify(status))
            } catch (err) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: String(err) }))
            }
            return
          }

          // 2. POST /api/whisper/cancel
          if (url === '/api/whisper/cancel' && req.method === 'POST') {
            res.setHeader('Content-Type', 'application/json')
            if (activeProcess) {
              try {
                activeProcess.kill('SIGKILL')
              } catch {
                // Ignore
              }
              activeProcess = null
            }
            cleanupTempFiles()
            res.statusCode = 200
            res.end(JSON.stringify({ cancelled: true }))
            return
          }

          // 3. POST /api/whisper/transcribe
          if (url === '/api/whisper/transcribe' && req.method === 'POST') {
            if (activeProcess) {
              res.statusCode = 409
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Ya hay una transcripción en curso.' }))
              return
            }

            const contentType = req.headers['content-type'] || ''

            // A) Direct local file transcription request via JSON metadata
            if (contentType.includes('application/json')) {
              let body = ''
              req.on('data', (chunk: Buffer) => {
                body += chunk.toString('utf-8')
              })
              req.on('end', () => {
                let parsed: {
                  mediaId?: string
                  fileName?: string
                  workspaceName?: string
                  model?: string
                  language?: string
                  device?: string
                }
                try {
                  parsed = JSON.parse(body)
                } catch {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'JSON inválido' }))
                  return
                }

                const {
                  mediaId,
                  fileName,
                  workspaceName,
                  model = 'large-v3-turbo',
                  language = 'auto',
                  device = 'cuda',
                } = parsed

                if (!mediaId || !fileName) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Faltan mediaId o fileName' }))
                  return
                }

                const localFile = findLocalMediaFile(mediaId, fileName, workspaceName)
                if (!localFile) {
                  res.statusCode = 404
                  res.setHeader('Content-Type', 'application/json')
                  res.end(
                    JSON.stringify({
                      notFound: true,
                      error: 'No se encontró el archivo en disco local',
                    }),
                  )
                  return
                }

                executeWhisper(localFile, false, model, language, device, res)
              })
              return
            }

            // B) Binary stream upload (fallback, streamed without memory limits)
            const model = (req.headers['x-whisper-model'] as string) || 'large-v3-turbo'
            const language = (req.headers['x-whisper-language'] as string) || 'auto'
            const device = (req.headers['x-whisper-device'] as string) || 'cuda'
            const rawFileName = req.headers['x-media-filename']
              ? decodeURIComponent(req.headers['x-media-filename'] as string)
              : ''
            const fileExt = extname(rawFileName) || '.mp4'

            const timestamp = Date.now()
            const tempDir = join(tmpdir(), 'freecut_whisper')
            if (!existsSync(tempDir)) {
              mkdirSync(tempDir, { recursive: true })
            }

            const tempAudioPath = join(tempDir, `audio_${timestamp}${fileExt}`)
            const fileStream = createWriteStream(tempAudioPath)
            let bytesReceived = 0

            req.on('data', (chunk: Buffer) => {
              bytesReceived += chunk.length
            })

            req.pipe(fileStream)

            fileStream.on('error', (err) => {
              cleanupTempFiles()
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: `Error guardando archivo de audio temporal: ${err.message}`,
                }),
              )
            })

            fileStream.on('finish', () => {
              if (bytesReceived === 0) {
                cleanupTempFiles()
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Audio buffer vacío' }))
                return
              }

              executeWhisper(tempAudioPath, true, model, language, device, res)
            })
            return
          }

          next()
        },
      )
    },
  }
}
