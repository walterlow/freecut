import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getPublicStudioAudioStatus, getStudioAudioConfig } from './studio-audio-config.mjs'
import { FreesoundService } from './freesound-service.mjs'
import { PixabayService } from './pixabay-service.mjs'

const config = getStudioAudioConfig()
const freesound = new FreesoundService(config)
const pixabay = new PixabayService(config)
await freesound.initialize()

function setCors(response, request) {
  const origin = request.headers.origin || ''
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('vary', 'origin')
  }
  response.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('cross-origin-resource-policy', 'cross-origin')
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readJson(request, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Request body is too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendNoContent(response) {
  response.writeHead(204)
  response.end()
}

function handleStatus(_request, response) {
  sendJson(response, 200, getPublicStudioAudioStatus(config, freesound.isOauthConnected()))
}

function handleAuthorize(_request, response) {
  const state = randomBytes(16).toString('hex')
  sendJson(response, 200, {
    authorizeUrl: freesound.getAuthorizeUrl(state),
    state,
    callbackUrl: config.callbackUrl,
  })
}

async function handleExchange(request, response) {
  const body = await readJson(request)
  sendJson(response, 200, await freesound.exchangeAuthorizationCode(body.code))
}

async function handleMatch(request, response) {
  const body = await readJson(request)
  sendJson(response, 200, {
    matches: await freesound.matchCues(Array.isArray(body.cues) ? body.cues : [], body.policy),
  })
}

async function handlePixabayMatch(request, response) {
  const body = await readJson(request)
  sendJson(response, 200, {
    matches: await pixabay.matchBeats(Array.isArray(body.beats) ? body.beats : []),
  })
}

// fallow-ignore-next-line complexity
async function handlePixabayAsset(response, assetKey) {
  const { response: upstream, asset } = await pixabay.fetchAsset(assetKey)
  const extension = asset.kind === 'video' ? 'mp4' : 'jpg'
  const headers = {
    'content-type': upstream.headers.get('content-type') || (asset.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    'content-disposition': `inline; filename="pixabay-${asset.id}.${extension}"`,
    'cache-control': 'private, max-age=86400',
  }
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers['content-length'] = contentLength
  response.writeHead(200, headers)
  if (upstream.body) for await (const chunk of upstream.body) response.write(chunk)
  response.end()
}

// fallow-ignore-next-line complexity
async function handleAsset(response, url, soundId) {
  const upstream = await freesound.fetchAsset(soundId, url.searchParams.get('original') === '1')
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'audio/mpeg',
    'content-disposition': upstream.headers.get('content-disposition') || 'inline',
    'cache-control': 'private, max-age=3600',
  }
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers['content-length'] = contentLength
  response.writeHead(200, headers)
  if (upstream.body) {
    for await (const chunk of upstream.body) response.write(chunk)
  }
  response.end()
}

const ROUTES = new Map([
  ['GET /api/studio-audio/status', handleStatus],
  ['GET /api/studio-audio/freesound/authorize', handleAuthorize],
  ['POST /api/studio-audio/freesound/exchange', handleExchange],
  ['POST /api/studio-audio/freesound/match', handleMatch],
  ['POST /api/studio-audio/pixabay/match', handlePixabayMatch],
])

// fallow-ignore-next-line complexity
async function handle(request, response) {
  setCors(response, request)
  if (request.method === 'OPTIONS') return sendNoContent(response)

  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  const assetMatch = url.pathname.match(/^\/api\/studio-audio\/freesound\/sounds\/(\d+)\/asset$/)
  if (request.method === 'GET' && assetMatch) return handleAsset(response, url, assetMatch[1])
  const pixabayAssetMatch = url.pathname.match(/^\/api\/studio-audio\/pixabay\/assets\/([a-z]+-\d+)$/)
  if (request.method === 'GET' && pixabayAssetMatch) return handlePixabayAsset(response, pixabayAssetMatch[1])

  const route = ROUTES.get(`${request.method} ${url.pathname}`)
  if (route) return route(request, response)

  sendJson(response, 404, { error: 'Not found' })
}

// fallow-ignore-next-line complexity
function handleServerError(error, response) {
  const status = Number(error?.status) || 500
  if (error?.retryAfter) response.setHeader('retry-after', error.retryAfter)
  sendJson(response, status, { error: error instanceof Error ? error.message : 'Request failed' })
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => handleServerError(error, response))
})

server.listen(config.port, '127.0.0.1', () => {
  const status = getPublicStudioAudioStatus(config, freesound.isOauthConnected())
  console.log(
    `[studio-audio] ready on http://127.0.0.1:${config.port} (freesound=${status.searchConfigured}, pixabay=${status.pixabayConfigured}, oauth=${status.oauthConnected})`,
  )
})
