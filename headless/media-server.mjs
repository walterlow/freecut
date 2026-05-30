// Tiny static media server for headless rendering.
//
// Serves media files by id with CORS + Cross-Origin-Resource-Policy headers so
// the harness page (which runs under COEP: require-corp) can fetch them
// cross-origin, plus HTTP Range support for partial reads.
import http from 'node:http'
import fs from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * @param {Map<string,string> | ((mediaId: string) => string | null)} mediaFilesOrResolver
 *   A mediaId->path Map, or a resolver function (mediaId) => absolute path | null.
 * @param {number} [port]  0 = ephemeral
 * @returns {Promise<{ base: string, url: (id: string) => string, close: () => Promise<void> }>}
 */
export async function createMediaServer(mediaFilesOrResolver, port = 0) {
  const resolveMedia =
    typeof mediaFilesOrResolver === 'function'
      ? mediaFilesOrResolver
      : (mediaId) => mediaFilesOrResolver.get(mediaId) ?? null
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Access-Control-Allow-Headers', 'range')
    res.setHeader('Access-Control-Expose-Headers', 'content-range, accept-ranges, content-length')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const match = requestUrl.pathname.match(/^\/media\/(.+)$/)
    if (!match) {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const mediaId = decodeURIComponent(match[1])
    const filePath = resolveMedia(mediaId)
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end(`media not found: ${mediaId}`)
      return
    }

    const { size } = await stat(filePath)
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Accept-Ranges', 'bytes')

    const range = req.headers.range
    if (range) {
      const parts = /bytes=(\d*)-(\d*)/.exec(range)
      let start = parts?.[1] ? Number.parseInt(parts[1], 10) : 0
      let end = parts?.[2] ? Number.parseInt(parts[2], 10) : size - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= size) end = size - 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }

    res.setHeader('Content-Length', size)
    if (req.method === 'HEAD') {
      res.writeHead(200)
      res.end()
      return
    }
    fs.createReadStream(filePath).pipe(res)
  })

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const actualPort = server.address().port
  const base = `http://127.0.0.1:${actualPort}`

  return {
    base,
    url: (mediaId) => `${base}/media/${encodeURIComponent(mediaId)}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
