import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/projects/')({
  // Clean up any media blob URLs when returning to projects page.
  beforeLoad: async () => {
    const [{ cleanupBlobUrls }, { useProjectStore }] = await Promise.all([
      import('@/features/media-library/utils/media-resolver'),
      import('@/features/projects/stores/project-store'),
    ])
    cleanupBlobUrls()
    // Always reload projects from storage to get fresh data (thumbnails may have changed).
    const { loadProjects } = useProjectStore.getState()
    await loadProjects()
  },
})
