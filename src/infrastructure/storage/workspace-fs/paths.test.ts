import { describe, expect, it } from 'vite-plus/test'

import { proxiesRoot, proxyDir, proxyFilePath, proxyMetaPath } from './paths'

describe('workspace proxy path builders', () => {
  it('preserves content-rooted proxy path segments byte-for-byte', () => {
    const proxyKey = 'f-abc123-10485760-1700000000'

    expect(proxiesRoot()).toEqual(['content', 'proxies'])
    expect(proxyDir(proxyKey)).toEqual(['content', 'proxies', proxyKey])
    expect(proxyFilePath(proxyKey)).toEqual(['content', 'proxies', proxyKey, 'proxy.mp4'])
    expect(proxyMetaPath(proxyKey)).toEqual(['content', 'proxies', proxyKey, 'meta.json'])
  })

  it('preserves persisted workspace proxy path strings byte-for-byte', () => {
    const proxyKey = 'h-deadbeef'

    expect(proxyFilePath(proxyKey).join('/')).toBe('content/proxies/h-deadbeef/proxy.mp4')
    expect(proxyMetaPath(proxyKey).join('/')).toBe('content/proxies/h-deadbeef/meta.json')
  })
})
