import type { DocPageContent } from '../docs-content'

const page = {
  order: 23,
  slug: 'reference',
  title: 'Reference',
  description: 'Supported formats and a glossary of the terms used across this guide.',
  category: 'Reference',
  related: ['concepts', 'keyboard-shortcuts'],
  sections: [
    {
      title: 'Formats',
      blocks: [
        {
          kind: 'table',
          headers: ['Use', 'Types'],
          rows: [
            ['Import', 'Video, audio, image, GIF, SVG, generated assets, compound clips'],
            ['Video export', 'MP4, MOV, WebM, MKV'],
            ['Audio export', 'MP3, AAC, WAV'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Codec support depends on what your browser can decode and encode.',
        },
      ],
    },
    {
      title: 'Editing terms',
      blocks: [
        {
          kind: 'table',
          headers: ['Term', 'Meaning'],
          rows: [
            ['In/out range', 'A marked start and end used for source edits and export ranges.'],
            ['Source handle', 'Spare frames beyond a clip edge, needed for trims and transitions.'],
            ['Ripple edit', 'An edit that shifts later material to open or close timeline space.'],
            ['Rolling edit', 'An edit that moves the cut between two neighboring clips.'],
            ['Slip edit', 'Changes the source frames inside a clip without moving the clip.'],
            ['Slide edit', 'Moves a clip while adjusting its neighboring cuts.'],
          ],
        },
      ],
    },
    {
      title: 'Feature terms',
      blocks: [
        {
          kind: 'table',
          headers: ['Term', 'Meaning'],
          rows: [
            ['Workspace', 'The folder FreeCut reads from and writes to.'],
            ['Proxy', 'A lighter generated copy of heavy media used for smoother playback.'],
            ['Compound clip', 'A section of timeline grouped into a single reusable media item.'],
            ['Adjustment layer', 'A layer whose effects and grade apply to the clips below it.'],
            ['Keyframe', 'A value set at a specific time to animate a property.'],
            ['LUT', 'A lookup table (.cube) that applies a color transform.'],
            ['Patch target', 'The timeline track a source-monitor edit is sent to.'],
            ['Render queue', 'An ordered list of exports that render one at a time.'],
            ['Preflight', 'The readiness check that runs before an export starts.'],
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
