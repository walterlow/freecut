import type { DocPageContent } from '../docs-content'

const page = {
  order: 16,
  slug: 'scene-browser',
  title: 'Scene Browser and AI Analysis',
  description:
    'Analyze media locally to caption scenes, then search by keyword, meaning, or color.',
  category: 'Creative Tools',
  related: ['media', 'local-ai', 'source-monitor'],
  sections: [
    {
      title: 'Analyze with AI',
      blocks: [
        {
          kind: 'list',
          items: [
            'Run **Analyze with AI** on a clip from the media library, or from the Scene Browser **Analyze** menu.',
            'The pass runs entirely on your machine: it detects scenes, captions each one, extracts a color palette, and builds text and image embeddings.',
            'Choose **Analyze new media** for clips without captions, or **Re-analyze all** to refresh everything.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Results are cached by content, so identical media is reused instead of analyzed again.',
        },
      ],
    },
    {
      title: 'Open the Scene Browser',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the Scene Browser from the media library, or with `Ctrl+Shift+F`.',
            'It searches the AI captions and scene data produced by Analyze with AI.',
            'Set the scope to all analyzed media or a single clip, and sort by **Relevance**, **Timestamp**, or **Media name**.',
            'Switch between **List view** and **Grid view** to suit browsing or scanning.',
          ],
        },
      ],
    },
    {
      title: 'Search modes',
      blocks: [
        {
          kind: 'table',
          headers: ['Mode', 'Matches by'],
          rows: [
            ['Keyword', 'The exact words in a caption — good for a specific object or label.'],
            [
              'Semantic',
              'Meaning, so "sunset over water" finds related scenes (first use downloads a small model, ~22 MB).',
            ],
            ['Color', 'A similar palette — pick a swatch from the library palette.'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Results carry match badges — Strong, Good, or Fair — and note whether the match was by keyword, meaning, visual similarity, or color.',
        },
      ],
    },
    {
      title: 'Use a result',
      blocks: [
        {
          kind: 'list',
          items: [
            'Click a scene to preview it in the source monitor.',
            'Drag a scene to the timeline to add that moment to your edit.',
            'If nothing is found, confirm the clip has been analyzed — only analyzed media is searchable.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
