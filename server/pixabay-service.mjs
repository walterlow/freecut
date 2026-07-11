const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const ALLOWED_ASSET_HOSTS = new Set(['cdn.pixabay.com'])

function cleanQuery(value) {
  return String(value || '')
    .replace(/[^a-z0-9\s'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isNative4k(asset) {
  const shortEdge = Math.min(asset.width, asset.height)
  const longEdge = Math.max(asset.width, asset.height)
  return shortEdge >= 2160 && longEdge >= 3840 && asset.width * asset.height >= 8_294_400
}

function qualityScore(asset, query) {
  const haystack = `${asset.tags} ${asset.pageUrl}`.toLowerCase()
  const relevance = cleanQuery(query)
    .toLowerCase()
    .split(' ')
    .filter((word) => word.length > 2)
    .reduce((score, word) => score + (haystack.includes(word) ? 24 : 0), 0)
  const pixels = asset.width * asset.height
  const resolution = Math.min(32, Math.log2(Math.max(1, pixels / 100_000)) * 7)
  const popularity = Math.min(18, Math.log10(Math.max(1, asset.downloads + asset.likes * 5)) * 5)
  return Math.round((relevance + resolution + popularity + (asset.editorsChoice ? 14 : 0)) * 100) / 100
}

function selectVideoVariant(videos = {}) {
  return ['large', 'medium', 'small', 'tiny']
    .map((name) => ({ name, ...videos[name] }))
    .filter((variant) => variant.url)
    .sort((left, right) => number(right.width) * number(right.height) - number(left.width) * number(left.height))[0]
}

// fallow-ignore-next-line complexity
function normalizeVideo(hit, query) {
  const variant = selectVideoVariant(hit.videos)
  if (!variant) return null
  const asset = {
    assetKey: `video-${hit.id}`,
    id: number(hit.id),
    kind: 'video',
    title: cleanQuery(hit.tags).split(',')[0] || `Pixabay video ${hit.id}`,
    tags: String(hit.tags || ''),
    pageUrl: String(hit.pageURL || ''),
    creator: String(hit.user || 'Pixabay contributor'),
    creatorId: number(hit.user_id),
    downloadUrl: String(variant.url),
    width: number(variant.width),
    height: number(variant.height),
    duration: number(hit.duration),
    downloads: number(hit.downloads),
    likes: number(hit.likes),
    editorsChoice: Boolean(hit.editors_choice),
    variant: variant.name,
  }
  return {
    ...asset,
    qualityTier: isNative4k(asset) ? 'native-4k' : 'hd',
    score: qualityScore(asset, query),
  }
}

// fallow-ignore-next-line complexity
function normalizeImage(hit, query) {
  const downloadUrl = hit.imageURL || hit.fullHDURL || hit.largeImageURL || hit.webformatURL
  if (!downloadUrl) return null
  const asset = {
    assetKey: `image-${hit.id}`,
    id: number(hit.id),
    kind: 'image',
    title: cleanQuery(hit.tags).split(',')[0] || `Pixabay image ${hit.id}`,
    tags: String(hit.tags || ''),
    pageUrl: String(hit.pageURL || ''),
    creator: String(hit.user || 'Pixabay contributor'),
    creatorId: number(hit.user_id),
    downloadUrl: String(downloadUrl),
    width: number(hit.imageWidth || hit.webformatWidth),
    height: number(hit.imageHeight || hit.webformatHeight),
    duration: 0,
    downloads: number(hit.downloads),
    likes: number(hit.likes),
    editorsChoice: Boolean(hit.editors_choice),
    variant: hit.imageURL ? 'original' : hit.fullHDURL ? 'full-hd' : hit.largeImageURL ? 'large' : 'web',
  }
  return {
    ...asset,
    qualityTier: isNative4k(asset) && Boolean(hit.imageURL) ? 'native-4k' : 'hd',
    score: qualityScore(asset, query),
  }
}

// fallow-ignore-next-line complexity
function apiError(response, body) {
  const message = typeof body === 'string' ? body : body?.error || body?.message
  const error = new Error(`Pixabay request failed (${response.status})${message ? `: ${message}` : ''}`)
  error.status = response.status
  error.retryAfter = response.headers.get('retry-after') || undefined
  return error
}

function publicAsset(asset) {
  const { downloadUrl: _downloadUrl, ...metadata } = asset
  return metadata
}

function preferredMediaKinds(preferImages) {
  return preferImages ? ['image', 'video'] : ['video', 'image']
}

export class PixabayService {
  constructor(config, dependencies = {}) {
    this.apiKey = config.pixabayApiKey || ''
    this.fetch = dependencies.fetch || globalThis.fetch
    this.now = dependencies.now || Date.now
    this.cache = new Map()
    this.assets = new Map()
  }

  isConfigured() {
    return Boolean(this.apiKey)
  }

  // fallow-ignore-next-line complexity
  async search(query, kind = 'video', options = {}) {
    if (!this.isConfigured()) throw Object.assign(new Error('Pixabay API key is not configured'), { status: 503 })
    const cleaned = cleanQuery(query)
    if (!cleaned) return []
    const strict4k = options.strict4k === true
    const cacheKey = `${kind}:${strict4k ? '4k' : 'hd'}:${cleaned.toLowerCase()}`
    const cached = this.cache.get(cacheKey)
    if (cached && this.now() - cached.createdAt < CACHE_TTL_MS) return cached.assets

    const endpoint = kind === 'image' ? 'https://pixabay.com/api/' : 'https://pixabay.com/api/videos/'
    const url = new URL(endpoint)
    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('q', cleaned)
    url.searchParams.set('lang', 'en')
    url.searchParams.set('safesearch', 'true')
    url.searchParams.set('order', 'popular')
    url.searchParams.set('per_page', '20')
    url.searchParams.set('min_width', strict4k ? '3840' : '1280')
    url.searchParams.set('min_height', strict4k ? '2160' : '720')
    if (kind === 'image') {
      url.searchParams.set('image_type', 'photo')
      url.searchParams.set('orientation', 'horizontal')
    } else {
      url.searchParams.set('video_type', 'film')
    }

    const response = await this.fetch(url)
    const body = await response.json().catch(async () => await response.text().catch(() => ''))
    if (!response.ok) throw apiError(response, body)
    const normalizer = kind === 'image' ? normalizeImage : normalizeVideo
    const assets = (Array.isArray(body.hits) ? body.hits : [])
      .map((hit) => normalizer(hit, cleaned))
      .filter(Boolean)
      .filter((asset) => asset.width >= 1280 && asset.height >= 720)
      .filter((asset) => !strict4k || asset.qualityTier === 'native-4k')
      .sort((left, right) => right.score - left.score)
    for (const asset of assets) this.assets.set(asset.assetKey, asset)
    this.cache.set(cacheKey, { createdAt: this.now(), assets })
    return assets
  }

  async matchBeats(beats, options = {}) {
    const used = new Set()
    const matches = []
    const preferredKinds = preferredMediaKinds(options.preferImages)
    for (const beat of beats.slice(0, 12)) {
      const query = cleanQuery(beat.query)
      const { candidates, selected } = await this.findUniqueAsset(
        query,
        preferredKinds,
        used,
        options.strict4k === true,
      )
      if (!selected) continue
      used.add(selected.assetKey)
      matches.push({
        beatId: String(beat.id),
        query,
        selected: publicAsset(selected),
        alternatives: candidates.slice(0, 4).map(publicAsset),
      })
    }
    return matches
  }

  async findUniqueAsset(query, preferredKinds, used, strict4k) {
    let candidates = []
    for (const kind of preferredKinds) {
      candidates = await this.search(query, kind, { strict4k })
      const selected = candidates.find((asset) => !used.has(asset.assetKey))
      if (selected) return { candidates, selected }
    }
    return { candidates, selected: null }
  }

  // fallow-ignore-next-line complexity
  async fetchAsset(assetKey) {
    const asset = this.assets.get(String(assetKey))
    if (!asset) throw Object.assign(new Error('Pixabay asset is not available in the current search cache'), { status: 404 })
    const url = new URL(asset.downloadUrl)
    if (url.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(url.hostname)) {
      throw Object.assign(new Error('Pixabay returned an unsupported asset host'), { status: 502 })
    }
    const response = await this.fetch(url)
    if (!response.ok) throw apiError(response, await response.text().catch(() => ''))
    return { response, asset }
  }
}
