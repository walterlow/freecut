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
  checksum: string // SHA-256 of manifest (excluding this field)
}

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
