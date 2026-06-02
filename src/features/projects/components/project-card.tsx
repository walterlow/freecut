import { useState, type KeyboardEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  MoreVertical,
  PlayCircle,
  Edit2,
  Copy,
  Trash2,
  AlertTriangle,
  HardDrive,
  Check,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types/project'
import { formatRelativeTime } from '../utils/project-helpers'
import {
  useDeleteProject,
  useDuplicateProject,
  useRestoreProject,
} from '../hooks/use-project-actions'
import { useProjectThumbnail } from '../hooks/use-project-thumbnail'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'

interface ProjectCardProps {
  project: Project
  onEdit?: (project: Project) => void
  isSelected?: boolean
  onCardMouseDown?: (e: React.MouseEvent, project: Project) => void
  onCardClick?: (e: React.MouseEvent, project: Project) => void
}

export function ProjectCard({
  project,
  onEdit,
  isSelected = false,
  onCardMouseDown,
  onCardClick,
}: ProjectCardProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [clearLocalFiles, setClearLocalFiles] = useState(false)
  const deleteProject = useDeleteProject()
  const restoreProject = useRestoreProject()
  const duplicateProject = useDuplicateProject()
  const thumbnailUrl = useProjectThumbnail(project)

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    setIsDeleting(true)
    setShowDeleteDialog(false)
    const wantedLocalDelete = clearLocalFiles
    const projectId = project.id
    const result = await deleteProject(projectId, clearLocalFiles)
    setIsDeleting(false)
    setClearLocalFiles(false)

    if (!result.success) {
      toast.error(t('projects.toasts.deleteFailed'), { description: result.error })
      return
    }

    if (wantedLocalDelete && !result.localFilesDeleted) {
      toast.warning(t('projects.toasts.movedToTrash', { name: result.originalName }), {
        description: t('projects.toasts.localFilesNotRemoved'),
      })
      return
    }

    toast.success(t('projects.toasts.movedToTrash', { name: result.originalName }), {
      description: wantedLocalDelete
        ? t('projects.toasts.localFilesDeleted')
        : t('projects.toasts.canUndo'),
      duration: 8000,
      action: {
        label: t('projects.undo'),
        onClick: async () => {
          const undo = await restoreProject(projectId)
          if (undo.success) {
            toast.success(t('projects.toasts.restored', { name: result.originalName }))
          } else {
            toast.error(t('projects.toasts.restoreFailed'), { description: undo.error })
          }
        },
      },
    })
  }

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setIsDuplicating(true)
    const result = await duplicateProject(project.id)
    setIsDuplicating(false)

    if (!result.success) {
      toast.error(t('projects.toasts.duplicateFailed'), { description: result.error })
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onEdit?.(project)
  }

  const handleClick = (e: React.MouseEvent) => {
    onCardClick?.(e, project)
  }

  const openProject = () => {
    navigate({ to: '/editor/$projectId', params: { projectId: project.id } })
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openProject()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    openProject()
  }

  const handleOpenClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openProject()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    onCardMouseDown?.(e, project)
  }

  // Safe metadata access with defaults
  const width = project?.metadata?.width || DEFAULT_PROJECT_WIDTH
  const height = project?.metadata?.height || DEFAULT_PROJECT_HEIGHT
  const fps = project?.metadata?.fps || DEFAULT_PROJECT_FPS

  const resolution = `${width}×${height}`
  const aspectRatio = width / height
  const aspectRatioLabel =
    Math.abs(aspectRatio - 16 / 9) < 0.01
      ? '16:9'
      : Math.abs(aspectRatio - 4 / 3) < 0.01
        ? '4:3'
        : Math.abs(aspectRatio - 1) < 0.01
          ? '1:1'
          : Math.abs(aspectRatio - 21 / 9) < 0.01
            ? '21:9'
            : `${width}:${height}`

  return (
    <div
      data-project-card
      data-project-id={project.id}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('projects.card.openProject')}
      className={`group relative panel-bg border rounded-lg overflow-hidden transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
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
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center">
          <Button size="sm" className="gap-2" onClick={handleOpenClick}>
            <PlayCircle className="w-4 h-4" />
            {t('projects.card.openProject')}
          </Button>
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
                  e.preventDefault()
                  e.stopPropagation()
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
                  {t('projects.card.openInEditor')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEdit} className="flex items-center gap-2">
                <Edit2 className="w-4 h-4" />
                {t('projects.card.editSettings')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className="flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {isDuplicating ? t('projects.card.duplicating') : t('projects.card.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDeleteClick}
                disabled={isDeleting}
                className="flex items-center gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? t('common.deleting') : t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog
          open={showDeleteDialog}
          onOpenChange={(open) => {
            setShowDeleteDialog(open)
            if (!open) setClearLocalFiles(false)
          }}
        >
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                {t('projects.card.deleteProjectTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                <Trans
                  i18nKey="projects.card.deleteProjectDescription"
                  values={{ name: project.name }}
                  components={{ strong: <strong /> }}
                />
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
                    {t('projects.card.alsoDeleteLocalFiles')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {project.rootFolderName
                      ? t('projects.card.removeFilesFromNamedFolder', {
                          folder: project.rootFolderName,
                        })
                      : t('projects.card.removeFilesFromFolder')}
                  </p>
                </div>
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t('projects.card.deleteProjectTitle')}
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
  )
}
