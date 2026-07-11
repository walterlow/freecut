import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_FILES = ['.env', '.env.local']

function parseEnvLine(line) {
  const trimmed = line.trim()
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) return null
  return [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]
}

function readEnvEntries(cwd, fileName) {
  const path = resolve(cwd, fileName)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).map(parseEnvLine).filter(Boolean)
}

function loadStudioAudioEnv(cwd = process.cwd()) {
  const loaded = Object.fromEntries(ENV_FILES.flatMap((fileName) => readEnvEntries(cwd, fileName)))
  return { ...loaded, ...process.env }
}

function envValue(env, key, fallback = '') {
  return typeof env[key] === 'string' && env[key] ? env[key] : fallback
}

export function getStudioAudioConfig(cwd = process.cwd()) {
  const env = loadStudioAudioEnv(cwd)
  return {
    port: Number(envValue(env, 'STUDIO_AUDIO_PORT', '8787')),
    apiKey: envValue(env, 'FREESOUND_API_KEY'),
    clientId: envValue(env, 'FREESOUND_CLIENT_ID'),
    clientSecret: envValue(env, 'FREESOUND_CLIENT_SECRET'),
    pixabayApiKey: envValue(env, 'PIXABAY_API_KEY'),
    callbackUrl: envValue(
      env,
      'FREESOUND_CALLBACK_URL',
      'http://freesound.org/home/app_permissions/permission_granted/',
    ),
  }
}

export function getPublicStudioAudioStatus(config, oauthConnected = false) {
  return {
    provider: 'freesound',
    searchConfigured: Boolean(config.apiKey),
    oauthConfigured: Boolean(config.clientId && config.clientSecret),
    oauthConnected,
    callbackUrl: config.callbackUrl,
    callbackMode: config.callbackUrl.includes('/home/app_permissions/permission_granted/')
      ? 'manual-code'
      : 'application-callback',
    pixabayConfigured: Boolean(config.pixabayApiKey),
  }
}
