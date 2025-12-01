import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Download,
  Save,
  Video,
  FolderArchive,
  ChevronDown,
} from 'lucide-react';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';

export interface ToolbarProps {
  projectId: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
  };
  isDirty?: boolean;
  onSave?: () => Promise<void>;
  onExport?: () => void;
  onExportBundle?: () => void;
}

export function Toolbar({ project, isDirty = false, onSave, onExport, onExportBundle }: ToolbarProps) {
  const navigate = useNavigate();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const handleBackClick = () => {
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      navigate({ to: '/projects' });
    }
  };

  const handleSave = async () => {
    if (onSave) {
      await onSave();
    }
  };

  return (
    <div className="panel-header h-14 border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
      {/* Project Info */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleBackClick}
          data-tooltip="Back to Projects"
          data-tooltip-side="right"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        {/* Unsaved Changes Dialog */}
        <UnsavedChangesDialog
          open={showUnsavedDialog}
          onOpenChange={setShowUnsavedDialog}
          onSave={handleSave}
          projectName={project?.name}
        />

        <Separator orientation="vertical" className="h-6" />

        <div className="flex flex-col -space-y-0.5">
          <h1 className="text-sm font-medium leading-none">
            {project?.name || 'Untitled Project'}
          </h1>
          <span className="text-xs text-muted-foreground font-mono">
            {project?.width}×{project?.height} • {project?.fps}fps
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Save & Export */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={handleSave}>
          <div className="relative">
            <Save className="w-4 h-4" />
            {isDirty && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
            )}
          </div>
          Save
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-2 glow-primary-sm">
              <Download className="w-4 h-4" />
              Export
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} className="gap-2">
              <Video className="w-4 h-4" />
              Export Video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportBundle} className="gap-2">
              <FolderArchive className="w-4 h-4" />
              Download Project (.zip)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
