import type { DocPageContent } from '../docs-content'

const page = {
  order: 18,
  slug: 'export',
  title: 'Exporting',
  description:
    'Render video or audio in the browser, choose formats and range, and clear preflight warnings.',
  category: 'Output',
  related: ['render-queue', 'text-captions-subtitles', 'troubleshooting'],
  sections: [
    {
      title: 'Set up an export',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open **Export** (`Ctrl+Shift+E`) and choose **Export Video** or **Export Audio**.',
            'Render the whole project, or the current in/out range when you only need a section.',
            'Set **Resolution** and **Quality** to match the goal: a quick review, a shareable file, or a final master.',
            'Clear any preflight warnings, then render.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Higher resolution and quality take longer and produce larger files.',
        },
      ],
    },
    {
      title: 'Formats and subtitles',
      blocks: [
        {
          kind: 'table',
          headers: ['Output', 'Formats'],
          rows: [
            ['Video containers', 'MP4, MOV, WebM, MKV'],
            ['Audio only', 'MP3, AAC, WAV'],
            ['Embedded subtitles', 'MP4, MKV, WebM'],
          ],
        },
        {
          kind: 'list',
          items: [
            'Which codecs are available depends on your browser; FreeCut warns or falls back when one is not.',
            'Turn on **Embed subtitles** to include transcript captions as a subtitle track.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Some players hide subtitle tracks by default, so viewers may need to enable them.',
        },
      ],
    },
    {
      title: 'Preflight checks',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Preflight runs before rendering and flags common blockers: an empty range, missing media, an unavailable codec, a worker-export fallback, a large file, or a long render.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'For a quick sanity check, export a short in/out range first before committing to the full render.',
        },
      ],
    },
    {
      title: 'Render and download',
      blocks: [
        {
          kind: 'list',
          items: [
            'Progress moves through preparing, rendering, encoding, and finalizing, and you can **Cancel** at any time.',
            'Worker export runs in the background when available; a main-thread fallback wants the tab focused and quiet.',
            'When it completes, choose **Download** to save the file, which is also written to the exports folder in your workspace.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Keep the project tab open until the export finishes. To batch several renders, add them to the **Render queue** instead of exporting one at a time.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
