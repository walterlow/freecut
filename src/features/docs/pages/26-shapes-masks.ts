import type { DocPageContent } from '../docs-content'

// order 11.5 places this right after Text, Captions, and Subtitles in Creative Tools.
const page = {
  order: 11.5,
  slug: 'shapes-masks',
  title: 'Shapes and Masks',
  description:
    'Add shape items, draw custom paths with the pen tool, and use any shape as a clip mask.',
  category: 'Creative Tools',
  related: ['properties', 'effects-color', 'keyframes'],
  sections: [
    {
      title: 'Add a shape',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the **Shapes** tab and click a shape to add it at the playhead, or drag it onto a specific track.',
            'Built-in shapes: **Rectangle**, **Circle**, **Ellipse**, **Triangle**, **Star**, **Polygon**, and **Heart**.',
            'A new shape lands sized to the canvas and selected, ready to position and style.',
          ],
        },
      ],
    },
    {
      title: 'Style a shape',
      blocks: [
        {
          kind: 'table',
          headers: ['Control', 'Notes'],
          rows: [
            ['Type', 'Switch between the seven shape types.'],
            ['Fill', 'The shape color.'],
            [
              'Stroke W. / Stroke',
              'Outline width (0–50 px) and its color (shown when width is above 0).',
            ],
            ['Radius', 'Corner rounding (0–100 px) for rectangle, triangle, star, and polygon.'],
            ['Points / Inner R.', 'Number of points and inner radius, for star and polygon.'],
            ['Direction', 'Which way a triangle points.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Position, size, rotation, and opacity live in the Transform controls, and most values can be keyframed — see [Keyframe Animation](keyframes).',
        },
      ],
    },
    {
      title: 'Draw a custom path with the pen tool',
      blocks: [
        {
          kind: 'steps',
          items: [
            'In the Shapes tab, choose the **Pen** tool to draw a custom path shape.',
            'Click in the preview to place points; click and drag a point to pull out curved (bezier) handles.',
            'Backspace removes the last point, and Escape cancels.',
            'With at least three points, choose **Finish Shape** to commit it (or **Cancel**).',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'To reshape a path later, select it and use **Edit Path**: drag points and handles, double-click an edge to add a point, and convert a point between **Corner** and **Bezier**. Choose **Done** when finished.',
        },
      ],
    },
    {
      title: 'Use a shape as a mask',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Place the shape on a track **above** the clip you want to mask.',
            'In the Shape section, turn on **Use as Mask**.',
            'Choose a **Mask Type**: **Clip** for hard edges, or **Alpha** for soft edges.',
            'For an Alpha mask, adjust **Feather** to soften the edge; use **Invert** to hide the shape area instead of revealing it.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'A mask affects everything on the tracks below it, by the shape geometry. Feather applies only to Alpha masks — Clip masks stay hard-edged.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'While you edit a mask or draw with the pen, the rest of the editor is locked — finish or exit mask editing to continue.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
