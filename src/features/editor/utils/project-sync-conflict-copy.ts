import type { Project } from '@/types/project'

export interface ConflictCopyProgress {
  conflictRevision: string | null
  project: Project
  mediaIds: string[]
  created: boolean
  associatedMediaIds: Set<string>
  projectListRefreshed: boolean
  savedNotificationShown: boolean
}

interface CreateConflictCopyProgressOptions {
  source: Project
  timeline: Project['timeline']
  mediaIds: string[]
  conflictRevision: string | null
  id: string
  now: number
}

interface PersistConflictCopyDependencies {
  getProject: (id: string) => Promise<Project | undefined>
  createProject: (project: Project) => Promise<Project>
  associateMedia: (projectId: string, mediaId: string) => Promise<void>
  refreshProjects: () => Promise<void>
}

export function createConflictCopyProgress({
  source,
  timeline,
  mediaIds,
  conflictRevision,
  id,
  now,
}: CreateConflictCopyProgressOptions): ConflictCopyProgress {
  const { rootFolderHandle, rootFolderName, thumbnailId, ...serializableSource } = source
  void rootFolderHandle
  void rootFolderName
  void thumbnailId
  return {
    conflictRevision,
    project: {
      ...serializableSource,
      id,
      name: `${source.name} · Conflict ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      timeline,
    },
    mediaIds: [...new Set(mediaIds)],
    created: false,
    associatedMediaIds: new Set(),
    projectListRefreshed: false,
    savedNotificationShown: false,
  }
}

export async function persistConflictCopy(
  progress: ConflictCopyProgress,
  dependencies: PersistConflictCopyDependencies,
): Promise<void> {
  if (!progress.created) {
    let existing = await dependencies.getProject(progress.project.id)
    if (!existing) {
      try {
        await dependencies.createProject(progress.project)
      } catch (error) {
        existing = await dependencies.getProject(progress.project.id)
        if (!existing) throw error
      }
    }
    progress.created = true
  }

  for (const mediaId of progress.mediaIds) {
    if (progress.associatedMediaIds.has(mediaId)) continue
    await dependencies.associateMedia(progress.project.id, mediaId)
    progress.associatedMediaIds.add(mediaId)
  }

  if (!progress.projectListRefreshed) {
    await dependencies.refreshProjects()
    progress.projectListRefreshed = true
  }
}
