/**
 * Project Snapshot Types
 *
 * Lightweight JSON export/import format for debugging, testing, and sharing
 * project structure without media files.
 */

import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'

// Snapshot format version
export const SNAPSHOT_VERSION = '1.0'

/**
 * Media reference in snapshot (metadata only, no file content)
 */
export interface SnapshotMediaReference {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  bitrate: number
  /** Content hash for deduplication matching on import */
  contentHash?: string
}

/**
 * Project snapshot for lightweight export/import
 */
export interface ProjectSnapshot {
  /** Snapshot format version */
  version: string
  /** ISO timestamp when snapshot was created */
  exportedAt: string
  /** Editor version that created this snapshot */
  editorVersion: string
  /** Complete project data */
  project: Project
  /** Media references (metadata only) */
  mediaReferences: SnapshotMediaReference[]
  /** Optional checksum for integrity verification */
  checksum?: string
}

/**
 * Validation result from schema validation
 */
export interface SnapshotValidationResult {
  valid: boolean
  errors: SnapshotValidationError[]
  warnings: SnapshotValidationWarning[]
}

export interface SnapshotValidationError {
  path: string
  message: string
  code: 'invalid_type' | 'missing_field' | 'invalid_value' | 'schema_mismatch'
}

export interface SnapshotValidationWarning {
  path: string
  message: string
  code: 'deprecated_field' | 'unknown_field' | 'version_mismatch' | 'missing_media'
}

/**
 * Import options for JSON import
 */
export interface SnapshotImportOptions {
  /** Generate new IDs for project and timeline items */
  generateNewIds?: boolean
  /** Override project name */
  newProjectName?: string
  /** Skip validation (use with caution) */
  skipValidation?: boolean
  /** Attempt to match media by content hash */
  matchMediaByHash?: boolean
  /** Attempt to match media by filename */
  matchMediaByName?: boolean
}

/**
 * Import result with media matching info
 */
export interface SnapshotImportResult {
  project: Project
  /** Media IDs that were matched to existing media */
  matchedMedia: Array<{
    snapshotMediaId: string
    localMediaId: string
    matchType: 'hash' | 'name' | 'exact'
  }>
  /** Media IDs that could not be matched */
  unmatchedMedia: string[]
  /** Warnings during import */
  warnings: string[]
}

/**
 * Export options for JSON export
 */
export interface SnapshotExportOptions {
  /** Include media references (default: true) */
  includeMediaReferences?: boolean
  /** Pretty print JSON (default: true for readability) */
  prettyPrint?: boolean
  /** Include checksum for integrity (default: true) */
  includeChecksum?: boolean
  /** Strip volatile fields like currentFrame, scrollPosition */
  stripVolatileFields?: boolean
}

/**
 * Convert MediaMetadata to SnapshotMediaReference
 */
export function mediaToSnapshotReference(media: MediaMetadata): SnapshotMediaReference {
  return {
    id: media.id,
    fileName: media.fileName,
    fileSize: media.fileSize,
    mimeType: media.mimeType,
    duration: media.duration,
    width: media.width,
    height: media.height,
    fps: media.fps,
    codec: media.codec,
    bitrate: media.bitrate,
    contentHash: media.contentHash,
  }
}
