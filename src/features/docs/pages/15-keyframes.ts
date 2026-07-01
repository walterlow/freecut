import type { DocPageContent } from '../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Keyframe Animation',
  description:
    'Animate transform, crop, text, effect, and audio values with keyframes, easing, and the curve editor.',
  category: 'Creative Tools',
  related: ['animate', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Open the keyframe editor',
      blocks: [
        {
          kind: 'list',
          items: [
            'Select an item, then open the keyframe editor from the sidebar button or with `Ctrl+Shift+A`.',
            'It opens in a **Split** view: the dopesheet on top for timing and the value graph below.',
            'Switch views with **Graph** for value curves and easing, or **Sheet** to move every keyframe on one grid — the `1` and `2` keys jump between them.',
          ],
        },
      ],
    },
    {
      title: 'Add a keyframe',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Move the playhead to the frame you want to key.',
            'Type a value next to a parameter and press `Enter`, or click the **diamond** on the parameter row.',
            'Move to another frame and set a second value to create motion between them.',
            'Or turn on **auto-key** (the timer icon) to capture every value change automatically as you work.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'You cannot add a keyframe inside a transition region, or with the playhead outside the clip bounds — the diamond is disabled there.',
        },
      ],
    },
    {
      title: 'What you can animate',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip type', 'Animatable values'],
          rows: [
            ['All visual clips', 'X / Y position, width, height, rotation, opacity, corner radius'],
            ['Video', 'Adds anchor point, the four crop edges, crop softness, and volume'],
            [
              'Text',
              'Adds preset scale, font size, line height, padding, background radius, shadow, and stroke',
            ],
            ['Audio', 'Volume in decibels'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Effects also contribute their own animatable parameters — look for the keyframe toggle beside each slider.',
        },
      ],
    },
    {
      title: 'Shape the motion',
      blocks: [
        {
          kind: 'list',
          items: [
            'Set per-keyframe interpolation: **Hold**, **Linear**, **Ease In**, **Ease Out**, **Ease In/Out**, **Bezier**, or **Spring**.',
            'Choose **Bezier** to open a curve editor and drag the handles, with named presets like Overshoot and Snap.',
            'Choose **Spring** for natural, bouncy motion without hand-tuning a curve.',
            'Copy, cut, paste, and delete keyframes, marquee-select groups, drag to retime, and `Alt`-drag to duplicate.',
          ],
        },
      ],
    },
    {
      title: 'Generated motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Some clips carry generated motion such as drift, breath, shake, or audio pulse, evaluated as they play. A clip with generated motion shows a **Bake motion** action.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bake the motion to convert it into editable keyframes you can adjust by hand.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
