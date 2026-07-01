import type { DocPageContent } from '../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Media Library',
  description:
    'Import media, inspect files, and generate proxies, transcripts, captions, and AI scene data.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Import media',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the **Media** tab and use **Import** to pick files, or drag files straight into the library.',
            'FreeCut handles video, audio, images, GIFs, SVGs, and generated assets. GIFs import as image items.',
            'Use **Import Media From URL** for a direct link to a media file — the URL must point at the file itself, not a page that embeds it.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Folder import is not supported yet — drop the media files directly. What decodes depends on your browser; if a file will not import, try a different format or transcode it first.',
        },
      ],
    },
    {
      title: 'Inspect a clip',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **Media info** to see codec, dimensions, duration, frame rate, file size, type, and transcript status.',
            'Double-click a media card, or use **Open In Source Monitor**, to preview a source before editing it in.',
            'Media cards expose menus for File, Proxy, Transcript, Embedded captions, and AI actions.',
            'Sort, filter, and group assets by type when the library grows large.',
          ],
        },
      ],
    },
    {
      title: 'Generate support data',
      blocks: [
        {
          kind: 'table',
          headers: ['Action', 'What it gives you'],
          rows: [
            [
              'Generate Proxy',
              'A lighter version of a heavy video for smoother editing; export still uses the original.',
            ],
            ['Generate Transcript', 'Editable speech text you can search and turn into captions.'],
            [
              'Extract Embedded Subtitles',
              'Subtitle tracks pulled from the file, ready to insert into the timeline.',
            ],
            [
              'Analyze with AI',
              'Local scene detection and captioning so clips become searchable in the Scene Browser.',
            ],
          ],
        },
      ],
    },
    {
      title: 'Compound clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'Group a section of the timeline into a **compound clip** that behaves like a single reusable media item.',
            'Compound clips appear in the media library and can be placed again like any other asset.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Nesting is one level deep — a compound clip cannot contain another compound clip.',
        },
      ],
    },
    {
      title: 'Fix missing media',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Missing Media appears when a linked file moved, was renamed, was deleted, or needs renewed permission. Use **Grant Access**, **Locate**, **Locate Folder**, or **Browse Another Folder** to restore the link. Use **Work Offline** only when you intend to relink later.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
