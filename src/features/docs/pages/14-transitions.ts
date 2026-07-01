import type { DocPageContent } from '../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Transitions',
  description:
    'Apply a transition to a cut and adjust its style, duration, placement, easing, and direction.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Apply a transition',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the **Transitions** tab in the media sidebar.',
            'Drag a transition card onto a cut between two adjacent clips — or select a valid cut and click a card.',
            'Select the transition on the timeline to open the **Transition** section in Properties.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A cut is valid when two clips sit edge to edge with enough spare source frames to overlap. Applying over an existing transition replaces it in place.',
        },
      ],
    },
    {
      title: 'Choose a look',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Cards are grouped by category: **Basic**, **Dissolve**, **Motion**, **Wipe**, **Slide**, **Flip**, **Mask**, **Iris**, **Shape**, **Light**, and **Chromatic**.',
        },
        {
          kind: 'list',
          items: [
            'Dissolve styles range from a plain Cross Dissolve to Additive, Blur, and Dip To Color variants.',
            'Motion and custom styles include Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch, and Sparkles.',
            'Directional styles such as Wipe, Slide, and Flip appear as several cards, one per direction.',
          ],
        },
      ],
    },
    {
      title: 'Adjust a transition',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'What it does'],
          rows: [
            ['Preset', 'Swap the transition style without redoing the cut.'],
            ['Duration', 'Set how long the transition runs; reset returns it to 1 second.'],
            ['Placement', 'Center on the cut, or shift the transition before or after it.'],
            ['Ease', 'Linear, In, Out, or In and Out.'],
            ['Direction', 'Left, Right, Top, or Bottom, for directional styles.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'You can also resize a transition by dragging its edge directly on the timeline.',
        },
      ],
    },
    {
      title: 'When a transition will not apply',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'You need a real cut between two clips, and enough **source handle** on the relevant side. If a placement is blocked, pick another placement or trim less. Dragging onto a valid cut always works, even when click-to-apply is unavailable.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
