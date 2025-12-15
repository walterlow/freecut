import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('NewProject');
import { ProjectForm } from '@/features/projects/components/project-form';
import { useCreateProject } from '@/features/projects/hooks/use-project-actions';
import type { ProjectFormData } from '@/features/projects/utils/validation';

export const Route = createFileRoute('/projects/new')({
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createProject = useCreateProject();

  const handleSubmit = async (data: ProjectFormData) => {
    setIsSubmitting(true);

    try {
      const result = await createProject(data);

      if (result.success && result.project) {
        // Navigate to editor with new project
        navigate({
          to: '/editor/$projectId',
          params: { projectId: result.project.id },
        });
      } else {
        toast.error('Failed to create project', { description: result.error });
        setIsSubmitting(false);
      }
    } catch (error) {
      logger.error('Failed to create project:', error);
      toast.error('Failed to create project', { description: 'Please try again' });
      setIsSubmitting(false);
    }
  };

  return <ProjectForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />;
}
