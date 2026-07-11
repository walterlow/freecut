import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { classifyFreesoundLicense, isAllowedFreesoundLicense } from './freesound-license.mjs'

const API_ROOT = 'https://freesound.org/apiv2'
const SEARCH_FIELDS = [
  'id',
  'name',
  'username',
  'license',
  'url',
  'previews',
  'duration',
  'samplerate',
  'bitdepth',
  'channels',
  'filesize',
  'num_downloads',
  'avg_rating',
  'description',
  'tags',
  'created',
].join(',')
const CACHE_TTL_MS = 10 * 60 * 1000
const SAFE_AUDIO_HOSTS = new Set(['freesound.org', 'cdn.freesound.org'])

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeQuery(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function numberOrZero(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function stringOr(value, fallback = '') {
  return typeof value === 'string' && value ? value : fallback
}

function pickPreview(previews = {}) {
  return (
    [previews['preview-hq-mp3'], previews['preview-lq-mp3'], previews['preview-hq-ogg']].find(
      Boolean,
    ) || ''
  )
}

function rankSound(sound, query, targetDuration) {
  const terms = new Set(query.toLowerCase().split(/\s+/).filter(Boolean))
  const tags = new Set((sound.tags || []).map((tag) => String(tag).toLowerCase()))
  const tagScore = [...terms].reduce((score, term) => score + (tags.has(term) ? 1.25 : 0), 0)
  const qualityScore = clamp(numberOrZero(sound.samplerate) / 48000, 0, 1.2) * 2
  const bitDepthScore = clamp(numberOrZero(sound.bitdepth) / 24, 0, 1) * 1.2
  const ratingScore = clamp(numberOrZero(sound.avg_rating) / 5, 0, 1) * 1.4
  const popularityScore = Math.log10(Math.max(1, numberOrZero(sound.num_downloads))) * 0.45
  const duration = numberOrZero(sound.duration)
  const durationScore = targetDuration
    ? Math.max(0, 1.8 - Math.abs(duration - targetDuration) / Math.max(2, targetDuration))
    : 0.8
  return tagScore + qualityScore + bitDepthScore + ratingScore + popularityScore + durationScore
}

function normalizeResult(sound, score) {
  const license = classifyFreesoundLicense(sound.license)
  return {
    id: Number(sound.id),
    name: stringOr(sound.name, `Freesound ${sound.id}`),
    username: stringOr(sound.username, 'Unknown creator'),
    license: license.exact,
    licenseCode: license.code,
    licenseUrl: license.exact,
    soundUrl: stringOr(sound.url, `https://freesound.org/s/${sound.id}/`),
    previewUrl: pickPreview(sound.previews),
    duration: numberOrZero(sound.duration),
    sampleRate: numberOrZero(sound.samplerate),
    bitDepth: numberOrZero(sound.bitdepth),
    channels: numberOrZero(sound.channels),
    fileSize: numberOrZero(sound.filesize),
    downloads: numberOrZero(sound.num_downloads),
    rating: numberOrZero(sound.avg_rating),
    description: stringOr(sound.description).slice(0, 1000),
    tags: Array.isArray(sound.tags) ? sound.tags.slice(0, 40).map(String) : [],
    created: stringOr(sound.created),
    score: Number(score.toFixed(3)),
  }
}

function createApiError(response, body) {
  const message = [body?.detail, body?.error_description, body?.error, response.statusText].find(
    Boolean,
  )
  const error = new Error(`Freesound request failed (${response.status}): ${message}`)
  error.status = response.status
  error.retryAfter = response.headers.get('retry-after')
  return error
}

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw createApiError(response, data)
  return data
}

function requireValue(value, message) {
  if (!value) throw new Error(message)
  return value
}

export class FreesoundService {
  constructor(config, options = {}) {
    this.config = config
    this.fetch = options.fetch || globalThis.fetch
    this.cache = new Map()
    this.tokenPath = options.tokenPath || resolve('.studio-audio', 'freesound-oauth.json')
    this.oauth = null
  }

  async initialize() {
    try {
      this.oauth = JSON.parse(await readFile(this.tokenPath, 'utf8'))
    } catch {
      this.oauth = null
    }
  }

  isOauthConnected() {
    return Boolean(this.oauth?.accessToken || this.oauth?.refreshToken)
  }

  getAuthorizeUrl(state) {
    if (!this.config.clientId) throw new Error('FREESOUND_CLIENT_ID is not configured')
    const url = new URL(`${API_ROOT}/oauth2/authorize/`)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('response_type', 'code')
    if (state) url.searchParams.set('state', state)
    return url.toString()
  }

  async exchangeAuthorizationCode(code) {
    requireValue(this.config.clientId, 'Freesound OAuth credentials are not configured')
    requireValue(this.config.clientSecret, 'Freesound OAuth credentials are not configured')
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      code: String(code || '').trim(),
    })
    const response = await this.fetch(`${API_ROOT}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await readApiResponse(response)
    await this.saveOauth(data)
    return { connected: true, expiresAt: this.oauth.expiresAt }
  }

  async saveOauth(data) {
    this.oauth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      expiresAt: Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000,
    }
    await mkdir(dirname(this.tokenPath), { recursive: true })
    const temporaryPath = `${this.tokenPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(this.oauth), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.tokenPath)
  }

  // fallow-ignore-next-line complexity
  async refreshOauthIfNeeded() {
    if (!this.oauth?.refreshToken) return this.oauth?.accessToken || null
    if (this.oauth.accessToken && this.oauth.expiresAt > Date.now()) return this.oauth.accessToken
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.oauth.refreshToken,
    })
    const response = await this.fetch(`${API_ROOT}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await readApiResponse(response)
    await this.saveOauth(data)
    return this.oauth.accessToken
  }

  // fallow-ignore-next-line complexity
  async search({ query, policy = 'youtube-safe', targetDuration = 6, pageSize = 15 }) {
    requireValue(this.config.apiKey, 'FREESOUND_API_KEY is not configured')
    const safeQuery = normalizeQuery(query)
    if (!safeQuery) return []
    const safePageSize = clamp(Number(pageSize) || 15, 1, 30)
    const cacheKey = JSON.stringify([safeQuery, policy, targetDuration, safePageSize])
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const url = new URL(`${API_ROOT}/search/text/`)
    url.searchParams.set('query', safeQuery)
    url.searchParams.set('page_size', String(safePageSize))
    url.searchParams.set('fields', SEARCH_FIELDS)
    url.searchParams.set('sort', 'rating_desc')
    const response = await this.fetch(url, {
      headers: { authorization: `Token ${this.config.apiKey}` },
    })
    const data = await readApiResponse(response)
    const results = (data.results || [])
      .filter((sound) => sound.previews && isAllowedFreesoundLicense(sound.license, policy))
      .map((sound) => normalizeResult(sound, rankSound(sound, safeQuery, targetDuration)))
      .sort((left, right) => right.score - left.score)
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: results })
    return results
  }

  async matchCues(cues, policy = 'youtube-safe') {
    const matches = []
    const usedIds = new Set()
    for (const cue of cues.slice(0, 48)) {
      const candidates = await this.search({
        query: cue.query,
        policy,
        targetDuration: cue.targetDuration,
        pageSize: 18,
      })
      const selected = candidates.find((candidate) => !usedIds.has(candidate.id)) || null
      if (selected) usedIds.add(selected.id)
      matches.push({
        cueId: cue.id,
        selected,
        alternatives: candidates.filter((candidate) => candidate.id !== selected?.id).slice(0, 3),
      })
    }
    return matches
  }

  async getSound(id) {
    requireValue(this.config.apiKey, 'FREESOUND_API_KEY is not configured')
    const response = await this.fetch(`${API_ROOT}/sounds/${Number(id)}/?fields=${SEARCH_FIELDS}`, {
      headers: { authorization: `Token ${this.config.apiKey}` },
    })
    const data = await readApiResponse(response)
    return normalizeResult(data, 0)
  }

  async fetchPreviewAsset(id) {
    const sound = await this.getSound(id)
    const previewUrl = new URL(sound.previewUrl)
    if (
      ![...SAFE_AUDIO_HOSTS].some(
        (host) => previewUrl.hostname === host || previewUrl.hostname.endsWith(`.${host}`),
      )
    ) {
      throw new Error('Freesound returned an unsupported preview host')
    }
    const response = await this.fetch(previewUrl, { redirect: 'follow' })
    if (!response.ok) throw createApiError(response, {})
    return response
  }

  async fetchOriginalAsset(id) {
    const accessToken = await this.refreshOauthIfNeeded()
    const response = await this.fetch(`${API_ROOT}/sounds/${Number(id)}/download/`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'follow',
    })
    if (!response.ok) await readApiResponse(response)
    return response
  }

  async fetchAsset(id, preferOriginal = false) {
    return preferOriginal && this.isOauthConnected()
      ? this.fetchOriginalAsset(id)
      : this.fetchPreviewAsset(id)
  }
}
