/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the hosted Telegram download server (default: http://localhost:8200). */
  readonly VITE_TELEGRAM_DOWNLOADER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
