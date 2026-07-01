import type { DocPageContent } from '../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Source Monitor Workflow',
  description:
    'Preview a source, mark an in/out range, choose patch targets, and insert or overwrite onto the timeline.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Open a source',
      blocks: [
        {
          kind: 'list',
          items: [
            'Double-click a media card, or use **Open In Source Monitor** from Media info, to load a source.',
            'The monitor header shows the source file name, with a close control to leave it.',
            'Source playback is independent of the timeline preview, so you can scrub a source without moving the timeline playhead.',
            'Click the timecode readout to toggle between timecode and frame-number display.',
          ],
        },
      ],
    },
    {
      title: 'Mark an in/out range',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Move to the first frame you want and press `I` (**Mark In**).',
            'Move to the frame after your last wanted frame and press `O` (**Mark Out**) — the out point is exclusive.',
            'Fine-tune by dragging the in handle, out handle, or the whole range on the strip.',
            'Use **Play In to Out** to review just the range, or `Alt+X` to clear it and use the full source.',
          ],
        },
      ],
    },
    {
      title: 'Choose patch targets',
      blocks: [
        {
          kind: 'list',
          items: [
            'The **V** toggle turns the video source-patch target on or off; the **A** toggle does the same for audio.',
            'Each toggle has a destination picker: **Auto**, a specific track by name, or **Create on edit** to make a new track.',
            'Video with sound places a linked video and audio pair across the V and A target tracks.',
            'The active timeline track pre-fills the matching V and A destinations.',
          ],
        },
      ],
    },
    {
      title: 'Insert and overwrite',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Both edits place the marked range at the current timeline playhead frame, then advance the playhead to the end of the new clip.',
        },
        {
          kind: 'table',
          headers: ['Edit', 'Key', 'What it does'],
          rows: [
            [
              'Insert',
              '`,`',
              'Drops the range in and pushes all later material on the target tracks to the right.',
            ],
            [
              'Overwrite',
              '`.`',
              'Replaces whatever timeline material sits under the range, leaving surrounding clips in place.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Images default to a **three-second** clip on edit unless you mark a shorter range.',
        },
      ],
    },
    {
      title: 'If an edit will not apply',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Enable at least one of the **V** or **A** patch targets first. To edit audio, enable **A**; to edit a silent video or image, enable **V**. A locked target track also blocks the edit — unlock it and try again.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
