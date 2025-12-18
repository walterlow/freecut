/**
 * Project Migration System
 *
 * Handles upgrading projects from older schema versions to the current version.
 *
 * Architecture:
 * 1. Version-based migrations - For breaking changes, run once per version bump
 * 2. Normalization - Applied every load to ensure current defaults
 *
 * Usage:
 *   import { migrateProject, CURRENT_SCHEMA_VERSION } from '@/lib/migrations';
 *
 *   const result = migrateProject(loadedProject);
 *   if (result.migrated) {
 *     await saveProject(result.project); // Persist the migrated version
 *   }
 */

import { createLogger } from '@/lib/logger';
import type { Project } from '@/types/project';
import type { MigrationResult } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import { getMigrationsToApply } from './migrations';
import { normalizeProject, didNormalizationChange } from './normalize';

const logger = createLogger('Migrations');

// Re-export types and constants
export { CURRENT_SCHEMA_VERSION } from './types';
export type { MigrationResult } from './types';

/**
 * Get the schema version from a project.
 * Projects without a schemaVersion are assumed to be version 1.
 */
function getSchemaVersion(project: Project): number {
  return (project as Project & { schemaVersion?: number }).schemaVersion ?? 1;
}

/**
 * Set the schema version on a project.
 */
function setSchemaVersion(project: Project, version: number): Project {
  return {
    ...project,
    schemaVersion: version,
  } as Project & { schemaVersion: number };
}

/**
 * Run version-based migrations on a project.
 */
function runMigrations(project: Project): {
  project: Project;
  appliedMigrations: number[];
  fromVersion: number;
} {
  const fromVersion = getSchemaVersion(project);
  const appliedMigrations: number[] = [];

  // Already at current version
  if (fromVersion >= CURRENT_SCHEMA_VERSION) {
    return { project, appliedMigrations, fromVersion };
  }

  // Get and apply migrations in order
  const migrationsToApply = getMigrationsToApply(fromVersion, CURRENT_SCHEMA_VERSION);
  let migratedProject = project;

  for (const migration of migrationsToApply) {
    logger.info(`Running migration v${migration.version}: ${migration.description}`);
    try {
      migratedProject = migration.migrate(migratedProject);
      appliedMigrations.push(migration.version);
    } catch (error) {
      logger.error(`Migration v${migration.version} failed:`, error);
      throw new Error(
        `Failed to migrate project from v${fromVersion} to v${migration.version}: ${error}`
      );
    }
  }

  // Update schema version
  migratedProject = setSchemaVersion(migratedProject, CURRENT_SCHEMA_VERSION);

  return { project: migratedProject, appliedMigrations, fromVersion };
}

/**
 * Migrate and normalize a project.
 *
 * This is the main entry point for the migration system.
 * Call this when loading a project from storage.
 *
 * @param project - The project loaded from storage
 * @returns Migration result with the updated project and metadata
 */
export function migrateProject(project: Project): MigrationResult {
  // Step 1: Run version-based migrations
  const { project: migrated, appliedMigrations, fromVersion } = runMigrations(project);

  // Step 2: Normalize to apply current defaults
  const normalized = normalizeProject(migrated);

  // Check if anything changed (migrations or normalization)
  const migratedByVersion = appliedMigrations.length > 0;
  const migratedByNormalization = !migratedByVersion && didNormalizationChange(project, normalized);

  return {
    project: normalized,
    migrated: migratedByVersion || migratedByNormalization,
    appliedMigrations,
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Check if a project needs migration.
 * Useful for showing UI indicators before loading.
 */
export function needsMigration(project: Project): boolean {
  const version = getSchemaVersion(project);
  return version < CURRENT_SCHEMA_VERSION;
}

/**
 * Get migration info for a project without actually migrating.
 */
export function getMigrationInfo(project: Project): {
  currentVersion: number;
  targetVersion: number;
  migrationsNeeded: number;
  migrationDescriptions: string[];
} {
  const currentVersion = getSchemaVersion(project);
  const migrations = getMigrationsToApply(currentVersion, CURRENT_SCHEMA_VERSION);

  return {
    currentVersion,
    targetVersion: CURRENT_SCHEMA_VERSION,
    migrationsNeeded: migrations.length,
    migrationDescriptions: migrations.map((m) => `v${m.version}: ${m.description}`),
  };
}
