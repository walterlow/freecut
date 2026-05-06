export const PROXY_DIR = 'proxies'
export const PROXY_FILE_NAME = 'proxy.mp4'
export const PROXY_META_FILE_NAME = 'meta.json'
export const PROXY_SCHEMA_VERSION = 4

function proxyOpfsDir(proxyKey: string): string {
  return `${PROXY_DIR}/${proxyKey}`
}

export function proxyOpfsFilePath(proxyKey: string): string {
  return `${proxyOpfsDir(proxyKey)}/${PROXY_FILE_NAME}`
}

export function proxyOpfsMetaPath(proxyKey: string): string {
  return `${proxyOpfsDir(proxyKey)}/${PROXY_META_FILE_NAME}`
}
