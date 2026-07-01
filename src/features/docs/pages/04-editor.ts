import type { DocPageContent } from '../docs-content'

const page = {
  order: 4,
  slug: 'editor',
  title: 'Editor Layout and Navigation',
  description:
    'The toolbar, media sidebar, preview monitor, timeline, properties, and the Edit and Color workspaces.',
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
        {
          kind: 'note',
          tone: 'info',
          text: 'A separate **Keyframe editor** button expands the sidebar into the animation editor.',
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
            'The **Animate** workspace opens the motion presets and keyframe graph for the selected clip — see [Animate Workspace](animate).',
            'Switch workspaces from the center toolbar tabs; Edit and Color also have keyboard shortcuts.',
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
