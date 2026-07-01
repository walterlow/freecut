import type { DocPageContent } from '../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Getting Started',
  description:
    'What FreeCut is, what your browser needs, and your first edit from launch to export.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'What FreeCut is',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut is a **local-first** video editor that runs entirely in your browser — there is no account, upload, or server render. Editing, effects, color, AI tools, and export all run on your own machine using your GPU and CPU.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Your media stays on your device. FreeCut links to the original files and writes projects, caches, and exports to a **workspace folder** you choose — nothing is sent to the cloud.',
        },
      ],
    },
    {
      title: 'What your browser needs',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut relies on modern web APIs, so a recent Chromium browser is the supported path.',
        },
        {
          kind: 'table',
          headers: ['Browser', 'Status'],
          rows: [
            ['Chrome / Edge 113+', 'Fully supported'],
            ['Brave', 'Works after enabling the File System Access API flag'],
            ['Safari / Firefox', 'Not yet supported for the full workflow'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'FreeCut uses the File System Access API (workspace folders), WebCodecs (decode and export), WebGPU (effects, color, AI), and OPFS (caches). Keep hardware acceleration on and GPU drivers current.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave may block folder access. Open `brave://flags/#file-system-access-api`, set it to **Enabled**, then relaunch Brave.',
        },
      ],
    },
    {
      title: 'Your first edit',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open FreeCut in a supported browser and, when prompted, pick a **workspace folder** you can read and write.',
            'On the Projects page, choose **New Project** and set the resolution and frame rate for the edit.',
            'Open the **Media** tab and use **Import** to add files, or drag media straight into the library.',
            'Drag a clip from the Media panel onto a timeline track.',
            'Press `Space` to play, and use `Left` and `Right` to step one frame at a time.',
            'Save with `Ctrl+S` as you work, then choose **Export** to render the finished video.',
          ],
        },
      ],
    },
    {
      title: 'Confirm your setup works',
      blocks: [
        {
          kind: 'list',
          items: [
            'The workspace picker opens and accepts a normal folder (not a protected system location).',
            'Imported media appears as cards in the Media panel with thumbnails.',
            'Playback starts from the timeline when you press `Space`.',
            'Export opens and the preflight check reports no blocking problems.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'If any step fails, see the **Troubleshooting** page for the matching symptom.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
