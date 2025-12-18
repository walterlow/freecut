/**
 * Application configuration from environment variables
 *
 * All environment variables must be prefixed with VITE_ to be exposed to the client.
 * See: https://vite.dev/guide/env-and-mode.html
 *
 * Usage:
 *   import { config, getServerConfig } from '@/lib/config';
 *   const url = config.api.baseUrl; // Static env var value
 *   const { baseUrl } = getServerConfig(); // Dynamic: settings > env var > default
 */

import { useSettingsStore } from '@/features/settings/stores/settings-store';

interface AppConfig {
  api: {
    baseUrl: string;
  };
  isDev: boolean;
  isProd: boolean;
}

interface ServerConfig {
  baseUrl: string;
}

function getEnvVar(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value : defaultValue;
}

const ENV_API_BASE_URL = getEnvVar('VITE_API_BASE_URL', 'http://localhost:3001/api');

export const config: AppConfig = {
  api: {
    baseUrl: ENV_API_BASE_URL,
  },
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
};

/**
 * Get the current server configuration.
 * Reads from settings store first, falls back to env vars, then defaults.
 *
 * This should be called when making API requests to get the latest user-configured URL.
 */
export function getServerConfig(): ServerConfig {
  const state = useSettingsStore.getState();
  return {
    baseUrl: state.serverApiUrl || ENV_API_BASE_URL,
  };
}
