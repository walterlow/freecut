import { useState, memo } from 'react';
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
  Share2,
  Keyboard,
  Settings,
} from 'lucide-react';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';

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
  onOpenShortcuts?: () => void;
  onOpenSettings?: () => void;
}

export const Toolbar = memo(function Toolbar({
  project,
  isDirty = false,
  onSave,
  onExport,
  onExportBundle,
  onOpenShortcuts,
  onOpenSettings,
}: ToolbarProps) {
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
    <div className="panel-header h-14 min-h-14 border-b border-border flex items-center px-3 md:px-4 gap-2 md:gap-3 flex-shrink-0 flex-wrap pt-[env(safe-area-inset-top)]">
      {/* Project Info */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 min-h-11 min-w-11 md:min-h-0 md:min-w-0 flex-shrink-0"
          onClick={handleBackClick}
          data-tooltip="Back to Projects"
          data-tooltip-side="right"
          aria-label="Back to projects"
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

        <Separator orientation="vertical" className="h-6 flex-shrink-0 hidden sm:block" />

        <div className="flex flex-col -space-y-0.5 min-w-0">
          <h1 className="text-sm font-medium leading-none truncate">
            {project?.name || 'Untitled Project'}
          </h1>
          <span className="text-xs text-muted-foreground font-mono hidden sm:block">
            {project?.width}×{project?.height} • {project?.fps}fps
          </span>
        </div>
      </div>

      <div className="flex-1 min-w-2" />

      {/* Save & Export - hidden on mobile; shown in left sidebar instead */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 min-h-10 min-w-10 md:min-h-0 md:min-w-0"
          onClick={() => onOpenSettings?.()}
          data-tooltip="Settings"
          data-tooltip-side="left"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 min-h-10 min-w-10 md:min-h-0 md:min-w-0"
          onClick={() => onOpenShortcuts?.()}
          data-tooltip="Keyboard Shortcuts"
          data-tooltip-side="left"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="w-4 h-4" />
        </Button>
        <WalletConnectButton size="sm" compact className="h-8 min-h-10 min-w-10 md:min-h-0 md:min-w-0" />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 min-h-10 min-w-10 md:min-h-0 md:min-w-0"
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
            <Share2 className="w-4 h-4" />
          </a>
        </Button>
        <Button variant="outline" size="sm" className="gap-2 min-h-10 min-w-10 md:min-h-0 md:min-w-0" onClick={handleSave} aria-label="Save project">
          <div className="relative">
            <Save className="w-4 h-4" />
            {isDirty && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#EC407A] rounded-full animate-pulse" />
            )}
          </div>
          Save
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-2 min-h-10 min-w-10 md:min-h-0 md:min-w-0 glow-primary-sm">
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
});
