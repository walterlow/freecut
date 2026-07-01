import type { DocPageContent } from '../docs-content'

const page = {
  order: 7,
  slug: 'editing-tools',
  title: 'Editing Tools',
  description:
    'Selection, razor, trim, slip, slide, rate stretch, and the ripple and rolling trim behaviors.',
  category: 'Core Editing',
  related: ['timeline', 'keyboard-shortcuts', 'properties'],
  sections: [
    {
      title: 'The core tools',
      blocks: [
        {
          kind: 'table',
          headers: ['Tool', 'Key', 'Use'],
          rows: [
            ['Selection', '`V`', 'Select, move, and arrange clips.'],
            ['Trim edit', '`T`', 'Drag a clip edge to change where it starts or ends.'],
            ['Razor', '`C`', 'Cut a clip wherever you click.'],
            ['Rate stretch', '`R`', 'Change duration by changing playback speed.'],
            ['Slip', '`Y`', 'Change the source frames inside a clip without moving it.'],
            ['Slide', '`U`', 'Move a clip while adjusting the neighboring cuts.'],
          ],
        },
      ],
    },
    {
      title: 'Trim behaviors',
      blocks: [
        {
          kind: 'list',
          items: [
            'A **ripple** trim changes an edit and shifts all later material, so the total duration changes.',
            'A **rolling** trim moves the cut between two neighboring clips, with no change to overall duration.',
            'A **slip** edit changes which source frames appear inside a clip without moving the clip or its neighbors.',
            'A **slide** edit moves a clip along the track while automatically adjusting the neighboring cuts.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple and rolling are behaviors of the **Trim edit** tool, not separate tools with their own shortcut.',
        },
      ],
    },
    {
      title: 'Keep clips in sync',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Linked selection** moves a video clip and its audio together; toggle it with `Shift+L`.',
            'Link clips with `Ctrl+Alt+L` and unlink them with `Alt+Shift+L` when a relationship needs to change.',
            '**Sync lock** on a track keeps timing aligned during ripple-style edits.',
          ],
        },
      ],
    },
    {
      title: 'Structural edits',
      blocks: [
        {
          kind: 'list',
          items: [
            'Insert a **freeze frame** at the playhead with `Shift+F` to hold a single frame.',
            'Group a run of clips into a **compound clip** to reuse or simplify a busy section.',
            'Use the **Bento layout** dialog to arrange selected visual clips into a structured grid.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
