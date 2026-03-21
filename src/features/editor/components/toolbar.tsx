import { memo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FolderArchive,
  Github,
  Keyboard,
  Save,
  Settings,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { LocalInferenceStatusPill } from './local-inference-status-pill';
import { SettingsDialog } from './settings-dialog';
import { ShortcutsDialog } from './shortcuts-dialog';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';

interface ToolbarProps {
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

export const Toolbar = memo(function Toolbar({
  project,
  isDirty = false,
  onSave,
  onExport,
  onExportBundle,
}: ToolbarProps) {
  const navigate = useNavigate();
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

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
    <div
      className="panel-header flex flex-shrink-0 items-center gap-2.5 border-b border-border px-3"
      style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarHeight }}
      role="toolbar"
      aria-label="Editor toolbar"
    >
      <div className="flex items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBackClick}
          data-tooltip="Back to Projects"
          data-tooltip-side="right"
          aria-label="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <UnsavedChangesDialog
          open={showUnsavedDialog}
          onOpenChange={setShowUnsavedDialog}
          onSave={handleSave}
          projectName={project?.name}
        />

        <Separator orientation="vertical" className="h-5" />

        <div className="flex flex-col -space-y-0.5">
          <h1 className="text-sm font-medium leading-none">
            {project?.name || 'Untitled Project'}
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            {project?.width}x{project?.height} | {project?.fps}fps
          </span>
        </div>
      </div>

      <div className="flex-1" />

      <LocalInferenceStatusPill />

      <ShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
      />

      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
      />

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowSettingsDialog(true)}
          data-tooltip="Settings"
          data-tooltip-side="left"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowShortcutsDialog(true)}
          data-tooltip="Keyboard Shortcuts"
          data-tooltip-side="left"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          asChild
        >
          <a
            href="https://github.com/walterlow/freecut"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip="View on GitHub"
            data-tooltip-side="left"
            aria-label="View on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleSave}
          aria-label="Save project"
        >
          <div className="relative">
            <Save className="h-4 w-4" />
            {isDirty && (
              <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-orange-500" />
            )}
          </div>
          Save
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5 glow-primary-sm">
              <Download className="h-4 w-4" />
              Export
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} className="gap-2">
              <Video className="h-4 w-4" />
              Export Video
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportBundle} className="gap-2">
              <FolderArchive className="h-4 w-4" />
              Download Project (.zip)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
