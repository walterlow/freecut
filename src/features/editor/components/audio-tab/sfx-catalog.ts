/**
 * SFX Catalog Definitions
 */

export interface SfxItem {
  id: string
  name: string
  category: 'transitions' | 'ui' | 'foley'
  duration: number // in seconds
  description: string
  assetPath: string
}

export const SFX_CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'transitions', label: 'Transiciones' },
  { id: 'ui', label: 'UI & Interfaz' },
  { id: 'foley', label: 'Ambiente & Foley' },
] as const

/**
 * Ruta de la carpeta donde se deben alojar los archivos físicos de audio (.wav, .mp3)
 */
export const SFX_ASSETS_DIR = 'public/assets/audio/sfx/'

/**
 * Catálogo de efectos de sonido.
 * Para añadir nuevos efectos, coloca los archivos en `public/assets/audio/sfx/`
 * y regístralos en este arreglo.
 */
export const SFX_ITEMS: SfxItem[] = []
