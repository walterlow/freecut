import { createFileRoute } from '@tanstack/react-router'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('NewProjectRoute')

export const Route = createFileRoute('/projects/new')({
  beforeLoad: async () => {
    try {
      const { useProjectStore } = await import('@/features/projects/stores/project-store')
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})
