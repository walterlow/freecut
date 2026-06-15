/**
 * Project Bundle Types
 *
 * Defines the format for exportable/importable project bundles (.freecut.zip)
 */

import type { Project, ProjectTimeline } from '@/types/project'

type BundleTimelineItem = Omit<ProjectTimeline['items'][number], 'mediaId'> & {
  mediaRef?: string
  [key: string]: unknown
}

type BundleComposition = Omit<NonNullable<ProjectTimeline['compositions']>[number], 'items'> & {
  items: BundleTimelineItem[]
}

type BundleTimeline = Omit<ProjectTimeline, 'items' | 'compositions'> & {
  items: BundleTimelineItem[]
  compositions?: BundleComposition[]
}

// Bundle format version
export const BUNDLE_VERSION = '1.0'

// Bundle file extension
export const BUNDLE_EXTENSION = '.freecut.zip'

/**
 * Manifest file structure (manifest.json in bundle)
 */
export interface BundleManifest {
  version: string
  createdAt: number
  editorVersion: string
  projectId: string
  projectName: string
  media: BundleMediaEntry[]
  /**
   * Animation presets sidecar entry. Present only when the project has at
   * least one saved preset; absent bundles import with an empty preset set.
   */
  animationPresets?: BundleAnimationPresetsEntry
  checksum: string // SHA-256 of manifest (excluding this field)
}

/**
 * Animation presets sidecar entry in manifest. Mirrors how media entries
 * point at an independently-collected file in the bundle.
 */
export interface BundleAnimationPresetsEntry {
  relativePath: string // Path within bundle (BUNDLE_ANIMATION_PRESETS_PATH)
  count: number // Number of presets in the sidecar file
}

/**
 * Stable bundle-root path for the animation presets sidecar, mirroring how
 * `project.json` sits at the bundle root.
 */
export const BUNDLE_ANIMATION_PRESETS_PATH = 'animation-presets.json'

/**
 * Media file entry in manifest
 */
export interface BundleMediaEntry {
  originalId: string // Original mediaId in source project
  relativePath: string // Path within bundle: media/{hash}/{filename}
  fileName: string
  fileSize: number
  sha256: string // Content hash for integrity verification
  mimeType: string
  metadata: {
    duration: number
    width: number
    height: number
    fps: number
    codec: string
    bitrate: number
  }
}

/**
 * Project data in bundle (project.json)
 */
export interface BundleProject extends Omit<Project, 'id' | 'timeline'> {
  id: string // Will be regenerated on import
  timeline?: BundleTimeline
}

/**
 * Export progress tracking
 */
export interface ExportProgress {
  percent: number
  stage: 'collecting' | 'hashing' | 'packaging' | 'complete'
  currentFile?: string
}

/**
 * Import progress tracking
 */
export interface ImportProgress {
  percent: number
  stage:
    | 'validating'
    | 'selecting_directory'
    | 'extracting'
    | 'importing_media'
    | 'linking'
    | 'complete'
  currentFile?: string
}

/**
 * Import conflict types
 */
export interface ImportConflict {
  type: 'project_name' | 'media_duplicate'
  description: string
  resolution: 'rename' | 'skip' | 'replace'
  originalValue?: string
  suggestedValue?: string
}

/**
 * Import options
 */
export interface ImportOptions {
  newProjectName?: string // Override project name
  skipDuplicateMedia?: boolean // Skip importing media that already exists
  destinationDirectory?: FileSystemDirectoryHandle // Where to extract media files
}

/**
 * Export result
 */
export interface ExportResult {
  blob?: Blob
  filename: string
  size: number
  mediaCount: number
}

/**
 * Import result
 */
export interface ImportResult {
  project: Project
  mediaImported: number
  mediaSkipped: number
  conflicts: ImportConflict[]
}
