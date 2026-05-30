// Standalone harness server for headless rendering — no Vite dev server needed.
//
// Serves the built harness (`dist/`) AND media from a single localhost origin
// with the cross-origin-isolation headers the harness needs (COEP/COOP), plus
// HTTP Range for media so large clips stream via mediabunny's UrlSource.
import http from 'node:http'
import fs from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  // media
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

async function serveFile(req, res, filePath, { allowRange } = { allowRange: false }) {
  let info
  try {
    info = await stat(filePath)
  } catch {
    res.writeHead(404)
    res.end('not found')
    return
  }
  if (!info.isFile()) {
    res.writeHead(404)
    res.end('not found')
    return
  }

  res.setHeader('Content-Type', contentType(filePath))
  const size = info.size
  const range = allowRange ? req.headers.range : undefined

  if (allowRange) res.setHeader('Accept-Ranges', 'bytes')

  if (range) {
    const parts = /bytes=(\d*)-(\d*)/.exec(range)
    let start = parts?.[1] ? Number.parseInt(parts[1], 10) : 0
    let end = parts?.[2] ? Number.parseInt(parts[2], 10) : size - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= size) end = size - 1
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(filePath, { start, end }).pipe(res)
    return
  }

  res.setHeader('Content-Length', size)
  if (req.method === 'HEAD') {
    res.writeHead(200)
    return res.end()
  }
  fs.createReadStream(filePath).pipe(res)
}

/**
 * @param {{ distDir: string, resolveMedia?: (mediaId: string) => string | null, port?: number }} opts
 *   resolveMedia maps a media id to an absolute source-file path (or null). Omit
 *   to serve no media (e.g. edit-only).
 * @returns {Promise<{ base: string, harnessUrl: string, mediaUrl: (id: string) => string, close: () => Promise<void> }>}
 */
export async function createHarnessServer({ distDir, resolveMedia = () => null, port = 0 }) {
  const resolvedDist = path.resolve(distDir)

  const server = http.createServer(async (req, res) => {
    // Cross-origin isolation for the harness page (matches the Vite dev server).
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')

    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }

    const mediaMatch = url.pathname.match(/^\/media\/(.+)$/)
    if (mediaMatch) {
      const filePath = resolveMedia(decodeURIComponent(mediaMatch[1]))
      if (!filePath) {
        res.writeHead(404)
        res.end('media not found')
        return
      }
      await serveFile(req, res, filePath, { allowRange: true })
      return
    }

    // Static dist serving.
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/headless.html'
    const filePath = path.join(resolvedDist, rel)
    if (!filePath.startsWith(resolvedDist)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    await serveFile(req, res, filePath, { allowRange: false })
  })

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  return {
    base,
    harnessUrl: `${base}/headless.html`,
    mediaUrl: (mediaId) => `${base}/media/${encodeURIComponent(mediaId)}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
