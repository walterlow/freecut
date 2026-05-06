import { describe, expect, it } from 'vite-plus/test'

import {
  mediaSourceByFileName,
  proxiesRoot,
  proxyDir,
  proxyFilePath,
  proxyMetaPath,
  sanitizeWorkspaceFileName,
} from './paths'

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

describe('workspace filename sanitizer', () => {
  it('preserves Windows reserved-name, trailing-dot, and trailing-space golden outputs', () => {
    expect(sanitizeWorkspaceFileName('CON')).toBe('CON_')
    expect(sanitizeWorkspaceFileName('con.mp4')).toBe('con_.mp4')
    expect(sanitizeWorkspaceFileName('LPT9.mov')).toBe('LPT9_.mov')
    expect(sanitizeWorkspaceFileName('clip. ')).toBe('clip')
    expect(sanitizeWorkspaceFileName(' clip name .mp4   ')).toBe('clip name .mp4')
    expect(sanitizeWorkspaceFileName('bad<name>|?.mp4')).toBe('bad_name___.mp4')
    expect(sanitizeWorkspaceFileName('     ')).toBe('source.bin')
  })

  it('preserves media source path strings after filename sanitization', () => {
    expect(mediaSourceByFileName('media-1', ' con?.mp4  ').join('/')).toBe('media/media-1/con_.mp4')
  })
})
