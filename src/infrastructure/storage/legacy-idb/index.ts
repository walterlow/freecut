/**
 * Legacy IndexedDB access — exists solely for the one-time migration path
 * from `video-editor-db` into the workspace folder. Nothing in the app's
 * normal runtime should import from here.
 *
 * The banner + settings flow imports `migrate-from-idb` via this barrel;
 * tests may import `./reader` directly.
 */

export {
  hasLegacyData,
  getMigrationStatus,
  migrateFromLegacyIDB,
  deleteLegacyIDB,
  type MigrationReport,
} from './migrate';
