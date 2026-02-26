import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HOTKEYS, HOTKEY_DESCRIPTIONS, type HotkeyKey } from '@/config/hotkeys';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Group shortcuts by category
const SHORTCUT_CATEGORIES: { name: string; keys: HotkeyKey[]; extra?: { description: string; binding: string }[] }[] = [
  {
    name: 'Playback',
    keys: ['PLAY_PAUSE', 'PREVIOUS_FRAME', 'NEXT_FRAME', 'GO_TO_START', 'GO_TO_END', 'PREVIOUS_SNAP_POINT', 'NEXT_SNAP_POINT'],
  },
  {
    name: 'Editing',
    keys: ['SPLIT_AT_PLAYHEAD', 'JOIN_ITEMS', 'DELETE_SELECTED', 'RIPPLE_DELETE'],
  },
  {
    name: 'History',
    keys: ['UNDO', 'REDO'],
  },
  {
    name: 'Zoom',
    keys: ['ZOOM_TO_FIT'],
    extra: [{ description: 'Zoom in/out', binding: 'Ctrl + Mouse Wheel' }],
  },
  {
    name: 'Clipboard',
    keys: ['COPY', 'PASTE'],
    extra: [{ description: 'Duplicate', binding: 'Alt + Drag' }],
  },
  {
    name: 'Tools',
    keys: ['SELECTION_TOOL', 'RAZOR_TOOL', 'SPLIT_AT_CURSOR', 'RATE_STRETCH_TOOL'],
  },
  {
    name: 'Project',
    keys: ['SAVE', 'EXPORT'],
  },
  {
    name: 'UI',
    keys: ['TOGGLE_SNAP'],
  },
  {
    name: 'Markers',
    keys: ['ADD_MARKER', 'REMOVE_MARKER', 'PREVIOUS_MARKER', 'NEXT_MARKER'],
  },
  {
    name: 'Keyframes',
    keys: [
      'ADD_KEYFRAME',
      'CLEAR_KEYFRAMES',
      'TOGGLE_KEYFRAME_EDITOR',
      'KEYFRAME_EDITOR_GRAPH',
      'KEYFRAME_EDITOR_DOPESHEET',
      'KEYFRAME_EDITOR_SPLIT',
    ],
  },
  {
    name: 'Source Monitor',
    keys: ['MARK_IN', 'MARK_OUT', 'CLEAR_IN_OUT', 'INSERT_EDIT', 'OVERWRITE_EDIT'],
  },
];

// Format key binding for display
function formatKeyBinding(key: string): string {
  return key
    .replace('mod', 'Ctrl')
    .replace('space', 'Space')
    .replace('comma', ',')
    .replace('period', '.')
    .replace('bracketleft', '[')
    .replace('bracketright', ']')
    .replace('left', '←')
    .replace('right', '→')
    .replace('up', '↑')
    .replace('down', '↓')
    .replace('home', 'Home')
    .replace('end', 'End')
    .replace('delete', 'Del')
    .replace('backspace', 'Backspace')
    .replace('escape', 'Esc')
    .replace('tab', 'Tab')
    .replace('equals', '+')
    .replace('minus', '-')
    .split('+')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' + ');
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {SHORTCUT_CATEGORIES.map((category) => (
              <div key={category.name}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  {category.name}
                </h3>
                <div className="space-y-1">
                  {category.keys.map((key) => (
                    <div
                      key={key}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">
                        {HOTKEY_DESCRIPTIONS[key]}
                      </span>
                      <kbd className="px-2 py-0.5 text-xs font-mono bg-muted rounded border border-border">
                        {formatKeyBinding(HOTKEYS[key])}
                      </kbd>
                    </div>
                  ))}
                  {category.extra?.map((item) => (
                    <div
                      key={item.binding}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{item.description}</span>
                      <kbd className="px-2 py-0.5 text-xs font-mono bg-muted rounded border border-border">
                        {item.binding}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
