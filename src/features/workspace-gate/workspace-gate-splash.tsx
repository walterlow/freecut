import { FolderOpen, FolderX, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FreeCutLogo } from '@/components/brand/freecut-logo';

type Status =
  | { kind: 'initializing' }
  | { kind: 'unavailable' }
  | { kind: 'pick' }
  | { kind: 'reconnect'; handleName: string };

interface Props {
  status: Status;
  onPickFolder: () => void;
  onReconnect: () => void;
}

export function WorkspaceGateSplash({ status, onPickFolder, onReconnect }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <FreeCutLogo variant="full" size="lg" className="justify-center mb-8" />

        {status.kind === 'initializing' && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {status.kind === 'unavailable' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <FolderX className="h-5 w-5" />
              <span className="font-medium">Unsupported browser</span>
            </div>
            <p className="text-sm text-muted-foreground">
              FreeCut requires a Chromium-based browser (Chrome, Edge, Brave,
              Arc) for its workspace folder storage. Firefox and Safari
              don't yet support the File System Access API.
            </p>
          </div>
        )}

        {status.kind === 'pick' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold mb-2">Pick your workspace folder</h1>
              <p className="text-sm text-muted-foreground">
                FreeCut stores all your projects, media, and caches as plain
                files in a folder you control. Pick any folder on disk — your
                projects will live there.
              </p>
            </div>
            <Button size="lg" className="gap-2" onClick={onPickFolder}>
              <FolderOpen className="h-4 w-4" />
              Choose folder
            </Button>
            <p className="text-xs text-muted-foreground">
              Tip: pick a folder in Dropbox, iCloud, or Google Drive to sync
              projects across devices. You can move it later.
            </p>
          </div>
        )}

        {status.kind === 'reconnect' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold mb-2">Reconnect your workspace</h1>
              <p className="text-sm text-muted-foreground">
                We need permission to access{' '}
                <span className="font-mono">{status.handleName}</span> again.
                This happens automatically between browser sessions.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="lg" className="gap-2" onClick={onPickFolder}>
                <FolderOpen className="h-4 w-4" />
                Choose a different folder
              </Button>
              <Button size="lg" className="gap-2" onClick={onReconnect}>
                <RefreshCw className="h-4 w-4" />
                Reconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
