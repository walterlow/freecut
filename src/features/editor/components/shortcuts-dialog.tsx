import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HotkeyEditor } from '@/features/editor/deps/settings';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent
        hideCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="h-[98vh] max-h-[98vh] max-w-[min(1600px,98vw)] gap-0 overflow-hidden border-white/10 bg-[#09090b]/96 p-0 shadow-[0_40px_120px_rgba(0,0,0,0.55)] sm:rounded-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Edit keyboard shortcut bindings.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <HotkeyEditor />
        </div>
      </DialogContent>
    </Dialog>
  );
}
