import type { DocPageContent } from '../docs-content'

const page = {
  order: 6,
  slug: 'timeline',
  title: 'Basic Timeline Editing',
  description:
    'Tracks, adding clips, selection, split and join, deleting, snapping, markers, ranges, and zoom.',
  category: 'Core Editing',
  related: ['editing-tools', 'preview', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Tracks',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Video tracks** hold visual items: video, images, text, shapes, captions, and adjustment layers.',
            '**Audio tracks** hold audio clips and the audio linked to video files.',
            'Add tracks with **Add Video Track** or **Add Audio Track** when you need more room.',
            'Track controls include **Lock**, **Solo**, **Enable/Disable** (visibility), and sync lock.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Track groups are one level deep and act as headers — mute, visibility, and lock flow from a group down to its tracks.',
        },
      ],
    },
    {
      title: 'Add and arrange clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Drag a clip from the Media panel onto a video or audio track.',
            'Use the **Selection** tool (`V`) to move and rearrange clips.',
            '**Linked selection** keeps a video clip and its audio moving together; unlink them to edit one alone.',
            'Nudge a selected item with `Shift+Arrow` (1px) or `Ctrl+Shift+Arrow` (10px).',
          ],
        },
      ],
    },
    {
      title: 'Split, join, and delete',
      blocks: [
        {
          kind: 'list',
          items: [
            'Split at the playhead with `Ctrl+K`, or use the **Razor** tool (`C`) to cut wherever you click.',
            'Join adjacent sections of the same clip with `Shift+J`.',
            '**Delete** leaves a gap; **Ripple Delete** (`Ctrl+Delete`) removes the clip and closes the gap.',
            'Use **Close All Gaps** to pull clips together and remove empty space on a track.',
          ],
        },
      ],
    },
    {
      title: 'Snapping, markers, and ranges',
      blocks: [
        {
          kind: 'list',
          items: [
            'Toggle snapping with `S` so clips snap to nearby cuts, markers, and the playhead.',
            'Add a marker with `M` for notes and timing references; jump between markers with `[` and `]`.',
            'Set an in point (`I`) and out point (`O`) to define a range for preview and export; clear them with `Alt+X`.',
          ],
        },
      ],
    },
    {
      title: 'Zoom and undo',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zoom with `Ctrl+=` and `Ctrl+-`, fit the whole edit with `\\`, and return to 100% with `Shift+\\`.',
            'Zoom changes only the view, never clip timing.',
            'Undo with `Ctrl+Z` and redo with `Ctrl+Shift+Z`; undo history depth is configurable in Settings.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
