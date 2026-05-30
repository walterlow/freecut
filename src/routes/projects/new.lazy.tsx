import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createLogger } from '@/shared/logging/logger'
import { ProjectForm } from '@/features/projects/components/project-form'
import { useCreateProject } from '@/features/projects/hooks/use-project-actions'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { Github } from 'lucide-react'
import type { ProjectFormData } from '@/features/projects/utils/validation'

const logger = createLogger('NewProject')

export const Route = createLazyFileRoute('/projects/new')({
  component: NewProject,
})

function NewProject() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const createProject = useCreateProject()

  const handleSubmit = async (data: ProjectFormData) => {
    setIsSubmitting(true)

    try {
      const result = await createProject(data)

      if (result.success && result.project) {
        // Navigate to editor with new project
        navigate({
          to: '/editor/$projectId',
          params: { projectId: result.project.id },
        })
      } else {
        toast.error(t('projects.toasts.createFailed'), { description: result.error })
        setIsSubmitting(false)
      }
    } catch (error) {
      logger.error('Failed to create project:', error)
      toast.error(t('projects.toasts.createFailed'), { description: t('projects.tryAgain') })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="panel-header border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/">
            <FreeCutLogo variant="full" size="md" className="hover:opacity-80 transition-opacity" />
          </Link>
          <Button variant="outline" size="icon" className="h-10 w-10" asChild>
            <a
              href="https://github.com/walterlow/freecut"
              target="_blank"
              rel="noopener noreferrer"
              data-tooltip={t('projects.viewOnGitHub')}
              data-tooltip-side="left"
            >
              <Github className="w-5 h-5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <ProjectForm onSubmit={handleSubmit} isSubmitting={isSubmitting} hideHeader={true} />
      </div>
    </div>
  )
}
