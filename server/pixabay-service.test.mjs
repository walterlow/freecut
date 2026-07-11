import assert from 'node:assert/strict'
import test from 'node:test'
import { PixabayService } from './pixabay-service.mjs'

function videoHit(id, tags = 'lighthouse ocean') {
  return {
    id,
    tags,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    user: 'cinematographer',
    user_id: 9,
    duration: 8,
    downloads: 2000,
    likes: 80,
    videos: { medium: { url: `https://cdn.pixabay.com/video/${id}.mp4`, width: 1920, height: 1080 } },
  }
}

test('search keeps the key server-side, caches for 24 hours, and ranks HD results', async () => {
  let requests = 0
  let requestedUrl = ''
  const service = new PixabayService(
    { pixabayApiKey: 'private-test-key' },
    { fetch: async (url) => {
      requests += 1
      requestedUrl = String(url)
      return new Response(JSON.stringify({ hits: [videoHit(7), videoHit(8, 'unrelated')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    } },
  )
  const first = await service.search('lighthouse ocean', 'video')
  const second = await service.search('lighthouse ocean', 'video')
  assert.equal(requests, 1)
  assert.equal(first[0].id, 7)
  assert.deepEqual(first, second)
  assert.match(requestedUrl, /safesearch=true/)
  assert.equal(JSON.stringify(first).includes('private-test-key'), false)
})

test('matching prefers unique videos and falls back to still images', async () => {
  const service = new PixabayService({ pixabayApiKey: 'test' })
  service.search = async (_query, kind) => kind === 'video'
    ? []
    : [{ assetKey: 'image-3', id: 3, kind: 'image', score: 90 }]
  const matches = await service.matchBeats([{ id: 'beat-1', query: 'old clock workshop' }])
  assert.equal(matches[0].selected.kind, 'image')
  assert.equal(matches[0].beatId, 'beat-1')
})

test('asset proxy rejects hosts that were not returned by Pixabay CDN', async () => {
  const service = new PixabayService({ pixabayApiKey: 'test' }, { fetch: async () => new Response('ok') })
  service.assets.set('video-1', { assetKey: 'video-1', downloadUrl: 'https://example.com/video.mp4' })
  await assert.rejects(service.fetchAsset('video-1'), /unsupported asset host/)
})
