import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { MoreVertical, PlayCircle, Edit2, Copy, Trash2, AlertTriangle, HardDrive, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { Project } from '@/types/project';
import { formatRelativeTime } from '../utils/project-helpers';
import {
  useDeleteProject,
  useDuplicateProject,
  useRestoreProject,
} from '../hooks/use-project-actions';
import { useProjectThumbnail } from '../hooks/use-project-thumbnail';

interface ProjectCardProps {
  project: Project;
  onEdit?: (project: Project) => void;
  isSelected?: boolean;
  onCardMouseDown?: (e: React.MouseEvent, project: Project) => void;
  onCardClick?: (e: React.MouseEvent, project: Project) => void;
}

export function ProjectCard({ project, onEdit, isSelected = false, onCardMouseDown, onCardClick }: ProjectCardProps) {
  const navigate = useNavigate();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [clearLocalFiles, setClearLocalFiles] = useState(false);
  const deleteProject = useDeleteProject();
  const restoreProject = useRestoreProject();
  const duplicateProject = useDuplicateProject();
  const thumbnailUrl = useProjectThumbnail(project);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setShowDeleteDialog(false);
    const wantedLocalDelete = clearLocalFiles;
    const projectId = project.id;
    const result = await deleteProject(projectId, clearLocalFiles);
    setIsDeleting(false);
    setClearLocalFiles(false);

    if (!result.success) {
      toast.error('Failed to delete project', { description: result.error });
      return;
    }

    if (wantedLocalDelete && !result.localFilesDeleted) {
      toast.warning(`Moved "${result.originalName}" to trash`, {
        description: 'Local files were not removed — you may need to delete the folder manually.',
      });
      return;
    }

    toast.success(`Moved "${result.originalName}" to trash`, {
      description: wantedLocalDelete
        ? 'Local files deleted — undo will not restore them.'
        : 'You can undo this for the next few seconds.',
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const undo = await restoreProject(projectId);
          if (undo.success) {
            toast.success(`Restored "${result.originalName}"`);
          } else {
            toast.error('Failed to restore project', { description: undo.error });
          }
        },
      },
    });
  };

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDuplicating(true);
    const result = await duplicateProject(project.id);
    setIsDuplicating(false);

    if (!result.success) {
      toast.error('Failed to duplicate project', { description: result.error });
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit?.(project);
  };

  const handleClick = (e: React.MouseEvent) => {
    onCardClick?.(e, project);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate({ to: '/editor/$projectId', params: { projectId: project.id } });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    onCardMouseDown?.(e, project);
  };

  // Safe metadata access with defaults
  const width = project?.metadata?.width || 1920;
  const height = project?.metadata?.height || 1080;
  const fps = project?.metadata?.fps || 30;

  const resolution = `${width}×${height}`;
  const aspectRatio = width / height;
  const aspectRatioLabel =
    Math.abs(aspectRatio - 16 / 9) < 0.01
      ? '16:9'
      : Math.abs(aspectRatio - 4 / 3) < 0.01
        ? '4:3'
        : Math.abs(aspectRatio - 1) < 0.01
          ? '1:1'
          : Math.abs(aspectRatio - 21 / 9) < 0.01
            ? '21:9'
            : `${width}:${height}`;

  return (
    <div
      data-project-card
      data-project-id={project.id}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group relative panel-bg border rounded-lg overflow-hidden transition-all cursor-pointer select-none ${
        isSelected
          ? 'border-primary ring-2 ring-primary/40 shadow-lg shadow-primary/10'
          : 'border-border hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5'
      }`}
    >
      {/* Selection check badge */}
      {isSelected && (
        <div className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md pointer-events-none">
          <Check className="w-4 h-4" strokeWidth={3} />
        </div>
      )}

      {/* Thumbnail */}
      <div className="block relative aspect-video bg-secondary/30 overflow-hidden">
        {thumbnailUrl ? (
          <img
            key={project.updatedAt}
            src={thumbnailUrl}
            alt={project.name}
            draggable={false}
            className="w-full h-full object-contain bg-black/40 pointer-events-none"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary/40 to-secondary/20">
            <PlayCircle className="w-12 h-12 text-muted-foreground/40" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-white">
            <PlayCircle className="w-6 h-6" />
            <span className="font-medium">Double-click to open</span>
          </div>
        </div>

        {/* Resolution badge */}
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/80 backdrop-blur-sm rounded text-xs font-mono text-white pointer-events-none">
          {resolution}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {project.description}
              </p>
            )}
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link
                  to="/editor/$projectId"
                  params={{ projectId: project.id }}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <PlayCircle className="w-4 h-4" />
                  Open in Editor
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEdit} className="flex items-center gap-2">
                <Edit2 className="w-4 h-4" />
                Edit Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className="flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {isDuplicating ? 'Duplicating...' : 'Duplicate'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className="flex items-center gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setClearLocalFiles(false);
        }}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Delete Project
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{project.name}</strong>? This action cannot be
                undone and will permanently remove the project and all its contents.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {project.rootFolderHandle && (
              <label className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clearLocalFiles}
                  onChange={(e) => setClearLocalFiles(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-destructive"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                    Also delete local files on disk
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Remove files from the linked folder{project.rootFolderName ? ` "${project.rootFolderName}"` : ''}. This cannot be undone.
                  </p>
                </div>
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Metadata */}
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="font-mono">{aspectRatioLabel}</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <div className="flex items-center gap-1.5">
            <span className="font-mono">{fps}fps</span>
          </div>
          <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <div className="flex items-center gap-1.5">
            <span>{formatRelativeTime(project.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
