/**
 * Migration System Types
 *
 * Defines the structure for version-based project migrations.
 */

import type { Project } from '@/types/project';

/**
 * Current schema version.
 * Increment this when adding a new migration.
 */
export const CURRENT_SCHEMA_VERSION = 5;

/**
 * A migration function transforms a project from version N to N+1.
 * Migrations should be pure functions that don't modify the input.
 */
export type MigrationFn = (project: Project) => Project;

/**
 * Migration definition with metadata.
 */
export interface Migration {
  /** Target version (the version after this migration runs) */
  version: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** The migration function */
  migrate: MigrationFn;
}

/**
 * Result of running migrations on a project.
 */
export interface MigrationResult {
  /** The migrated project */
  project: Project;
  /** Whether any migrations were applied */
  migrated: boolean;
  /** List of migrations that were applied */
  appliedMigrations: number[];
  /** The original schema version */
  fromVersion: number;
  /** The final schema version */
  toVersion: number;
}
