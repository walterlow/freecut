/**
 * Adapter exports for projects dependencies.
 * Editor modules should import projects stores/services from here.
 */

export { useProjectStore } from '@/features/projects/stores/project-store';
export { createProjectUpgradeBackup } from '@/features/projects/services/project-upgrade-service';
export { formatProjectUpgradeBackupName } from '@/features/projects/utils/project-helpers';
export { formatFpsValue, resolveAutoMatchProjectFps } from '@/features/projects/utils/project-fps';
