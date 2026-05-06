export function isVideoProxyCandidate(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}
