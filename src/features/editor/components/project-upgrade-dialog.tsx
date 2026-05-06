import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, HardDrive, RefreshCw } from 'lucide-react'

interface ProjectUpgradeDialogProps {
  backupName: string
  currentSchemaVersion: number
  isUpgrading: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  projectName: string
  storedSchemaVersion: number
}

export function ProjectUpgradeDialog({
  backupName,
  currentSchemaVersion,
  isUpgrading,
  onCancel,
  onConfirm,
  open,
  projectName,
  storedSchemaVersion,
}: ProjectUpgradeDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isUpgrading) {
          onCancel()
        }
      }}
    >
      <DialogContent
        className="max-w-lg"
        hideCloseButton
        onEscapeKeyDown={(event) => {
          if (isUpgrading) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Upgrade Project Before Opening
          </DialogTitle>
          <DialogDescription className="space-y-3 pt-1">
            <span className="block">
              <strong>{projectName}</strong> was saved with project schema v{storedSchemaVersion},
              but this build expects v{currentSchemaVersion}.
            </span>
            <span className="block">
              FreeCut can upgrade it for you before loading the editor. A backup of the pre-upgrade
              project will be created first so you can restore the old data if anything looks off.
            </span>
            <span className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              Backup copy: <strong>{backupName}</strong>
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isUpgrading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isUpgrading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isUpgrading ? 'animate-spin' : ''}`} />
            {isUpgrading ? 'Creating Backup...' : 'Create Backup & Upgrade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
