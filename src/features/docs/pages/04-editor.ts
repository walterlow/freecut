import type { DocPageContent } from '../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Editor Layout and Navigation',
  description:
    'The toolbar, media sidebar, preview monitor, timeline, properties, and the Edit, Color, and Motion workspaces.',
  category: 'Start',
  related: ['concepts', 'timeline', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'The main surfaces',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Editor toolbar** (top): Back to Projects, workspace tabs, project specs, language, Settings, Keyboard Shortcuts, Save, Export, and the Render queue.',
            '**Media sidebar** (left): your assets and creation tools.',
            '**Preview monitor**: the current frame with overlays, masks, scopes, and playback controls.',
            '**Timeline** (bottom): tracks, clips, markers, and edit tools.',
            '**Properties** panel: edits whatever clip or clips you have selected.',
          ],
        },
      ],
    },
    {
      title: 'The media sidebar tabs',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'Contents'],
          rows: [
            [
              'Media',
              'Imported assets, media info, proxies, transcripts, captions, compound clips, missing-media controls',
            ],
            ['Text', 'Text clips from single-span and multi-span templates'],
            ['Shapes', 'Generated shape items'],
            ['Effects', 'GPU effects for the selected clip'],
            ['Transitions', 'Transitions to drag onto cuts'],
            ['AI', 'Local text to speech and music generation'],
          ],
        },
      ],
    },
    {
      title: 'Workspaces',
      blocks: [
        {
          kind: 'list',
          items: [
            'The **Edit** workspace (`Alt+1`) is the default cutting layout for arranging, trimming, text, shapes, effects, transitions, and preview.',
            'The **Color** workspace (`Alt+2`) focuses on grading, with color wheels, curves, and scopes for the selected clip.',
            'The **Motion** workspace combines layered compositions, keyframes, graphs, presets, and procedural animation — see [Motion Workspace](motion).',
            'Select a visual clip in Edit and open **Animation** in Properties for common presets, applied-animation status, text motion, and **Create Motion Clip**.',
            'Switch workspaces from the center toolbar tabs, or use `Alt+1`, `Alt+2`, and `Alt+3`.',
            'Use **Layout** between Settings and Keyboard Shortcuts to place the timeline above, below, left, or right of the preview. In Color, this moves the grading panel. Choose **Edit layout** to drag the panel or select a position; **Reset layout** restores the default split for the current workspace.',
          ],
        },
      ],
    },
    {
      title: 'Getting help and staying safe',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **Settings** for general, timeline, AI, and storage preferences.',
            'Open **Keyboard Shortcuts** to search commands, rebind keys, and import or export presets.',
            'Save often with `Ctrl+S`; auto-save can also run on an interval you set in Settings.',
            'Undo and Redo (`Ctrl+Z` and `Ctrl+Shift+Z`) cover timeline edits when something goes wrong.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
