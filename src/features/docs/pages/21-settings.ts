import type { DocPageContent } from '../docs-content'

const page = {
  order: 21,
  slug: 'settings',
  title: 'Settings',
  description:
    'The General, Timeline, AI, and Storage tabs, plus where language and shortcuts are set.',
  category: 'Reference',
  related: ['keyboard-shortcuts', 'workspaces'],
  sections: [
    {
      title: 'The four tabs',
      blocks: [
        {
          kind: 'table',
          headers: ['Tab', 'What you set'],
          rows: [
            [
              'General',
              'Auto-save on/off and interval (5–30 min); undo history depth (10–200 steps).',
            ],
            [
              'Timeline',
              'Snap by default; show waveforms and filmstrips; extract filmstrips on import.',
            ],
            ['AI', 'Caption sample interval (seconds or frames); default caption style.'],
            [
              'Storage',
              'Generate missing proxies; clear project cache; regenerate thumbnails; delete proxies; manage Local AI.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Clearing the project cache removes regenerated data (waveforms, filmstrips, GIF frames, decoded audio); it never deletes source media. Use **Reset** in the dialog header to restore defaults.',
        },
      ],
    },
    {
      title: 'Set elsewhere',
      blocks: [
        {
          kind: 'list',
          items: [
            'Interface **language** is a separate control in the toolbar, not part of this dialog; FreeCut ships in 9 languages.',
            'Keyboard shortcuts are customized in their own **Keyboard Shortcuts** panel.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'FreeCut currently uses a single dark theme; there is no theme selector.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
