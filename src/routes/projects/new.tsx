import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@/shared/logging/logger';
import { ProjectForm } from '@/features/projects/components/project-form';
import { useCreateProject } from '@/features/projects/hooks/use-project-actions';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { PixelsLogo } from '@/components/brand/pixels-logo';
import { Button } from '@/components/ui/button';
import { RequireWallet } from '@/components/require-wallet';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Share2 } from 'lucide-react';
import type { ProjectFormData } from '@/features/projects/utils/validation';

const logger = createLogger('NewProject');

export const Route = createFileRoute('/projects/new')({
  component: () => (
    <RequireWallet>
      <NewProject />
    </RequireWallet>
  ),
  beforeLoad: async () => {
    try {
      const { loadProjects } = useProjectStore.getState();
      await loadProjects();
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err);
    }
  },
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="panel-header border-b border-border">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
          <Link to="/">
            <PixelsLogo variant="full" size="md" className="hover:opacity-80 transition-opacity" />
          </Link>
          <div className="hidden items-center gap-2 md:flex">
            <WalletConnectButton size="sm" compact className="h-10" />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              asChild
            >
              <a
                href="https://tv.creativeplatform.xyz"
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip="Distribute"
                data-tooltip-side="left"
                aria-label="Distribute"
              >
                <Share2 className="w-5 h-5" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6">
        <ProjectForm onSubmit={handleSubmit} isSubmitting={isSubmitting} hideHeader={true} />
      </div>
    </div>
  );
}

