import type { DocPageContent } from '../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Keyboard Shortcuts',
  description: 'Default shortcuts by group, plus how to search, rebind, and reset them.',
  category: 'Reference',
  sections: [
    {
      title: 'Playback',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Play / Pause', '`Space`'],
            ['Previous / Next frame', '`Left` / `Right`'],
            ['Previous / Next snap point', '`Up` / `Down`'],
            ['Go to start / end', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Editing',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Split at playhead', '`Ctrl+K` (also `Alt+C`)'],
            ['Split at cursor', '`Shift+C`'],
            ['Join', '`Shift+J`'],
            ['Delete / Ripple delete', '`Delete` / `Ctrl+Delete`'],
            ['Insert freeze frame', '`Shift+F`'],
            ['Link / Unlink clips', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Toggle linked selection', '`Shift+L`'],
            ['Nudge 1px / 10px', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Tools',
      blocks: [
        {
          kind: 'table',
          headers: ['Tool', 'Shortcut'],
          rows: [
            ['Selection', '`V`'],
            ['Trim edit', '`T`'],
            ['Razor', '`C`'],
            ['Rate stretch', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple and rolling are trim behaviors of the **Trim edit** tool, not separate tools with their own shortcut.',
        },
      ],
    },
    {
      title: 'History, view, and clipboard',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Undo / Redo', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Copy / Cut / Paste', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Toggle snap / canvas snap', '`S` / `Shift+S`'],
            ['Zoom in / out', '`Ctrl+=` / `Ctrl+-`'],
            ['Zoom to fit / 100%', '`\\` / `Shift+\\`'],
            ['Toggle keyframe editor', '`Ctrl+Shift+A`'],
            ['Edit / Color workspace', '`Alt+1` / `Alt+2`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'The Animate workspace has no default shortcut — open it from its toolbar tab.',
        },
      ],
    },
    {
      title: 'Markers and keyframes',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Add / Remove marker', '`M` / `Shift+M`'],
            ['Previous / Next marker', '`[` / `]`'],
            ['Clear keyframes', '`Shift+A`'],
            ['Keyframe graph / sheet view', '`1` / `2`'],
          ],
        },
      ],
    },
    {
      title: 'Source monitor and project',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'Shortcut'],
          rows: [
            ['Mark In / Out', '`I` / `O`'],
            ['Clear In/Out', '`Alt+X`'],
            ['Insert / Overwrite edit', '`,` / `.`'],
            ['Save', '`Ctrl+S`'],
            ['Export', '`Ctrl+Shift+E`'],
            ['Open Scene Browser', '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Customize shortcuts',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open **Keyboard Shortcuts** from the toolbar to search commands and bindings.',
            'Select a command and record a new key, resolving any conflict it reports.',
            'Export a preset for backup or transfer, and import one on another machine.',
            'Use **Reset** to restore the defaults.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Every binding above is the shipped default and can be remapped to whatever you prefer.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
