import type { DocPageContent } from '../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Effects and Color',
  description:
    'Add and stack GPU effects, grade with wheels and curves, read scopes, apply LUTs, and isolate corrections.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Add and manage effects',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Select a clip and open the **Effects** section in Properties.',
            'Use **Add Effect**, then search or pick from a category. You can also add built-in **Presets** or your own saved presets.',
            'Reorder the stack with **Move up** and **Move down** — order changes how effects combine.',
            'Disable, reset, or remove an effect from its panel; numeric parameters can be keyframed.',
          ],
        },
      ],
    },
    {
      title: 'The effect catalog',
      blocks: [
        {
          kind: 'table',
          headers: ['Category', 'Effects'],
          rows: [
            [
              'Color',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Blur', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Distort',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, and more',
            ],
            [
              'Stylize',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, Halftone, Dither, ASCII, VHS, glitch looks',
            ],
            ['Keying', 'Chroma Key (green- and blue-screen removal)'],
          ],
        },
      ],
    },
    {
      title: 'Grade in the Color workspace',
      blocks: [
        {
          kind: 'list',
          items: [
            'Switch to the **Color** workspace (`Alt+2`) and select a clip; the wheels and curves are ready even before a grade exists.',
            '**Color Wheels** adjust Shadows, Midtones, Highlights, and Offset, with white-balance pickers and auto balance.',
            '**Curves** edit the Master, Red, Green, and Blue channels; click a curve to add a point and double-click a point to remove it.',
            'Compare with **Before**, **After**, and **Split**, and copy a look between clips with **Copy Grade** and **Paste Grade**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Bypass grade** previews the ungraded image but never affects exports.',
        },
      ],
    },
    {
      title: 'Read the scopes',
      blocks: [
        {
          kind: 'table',
          headers: ['Scope', 'Shows'],
          rows: [
            ['Waveform', 'Luminance and color distribution, top to bottom'],
            ['RGB Parade', 'The red, green, and blue channels side by side'],
            ['Vectorscope', 'Hue and saturation'],
            ['Histogram', 'The spread of tones'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Toggle the scopes with **Show Color Scopes**. Waveform and Histogram also offer RGB, single-channel, and luma (Y) views.',
        },
      ],
    },
    {
      title: 'LUTs and isolated corrections',
      blocks: [
        {
          kind: 'list',
          items: [
            'Add the **LUT (.cube)** effect, choose **Import .cube LUT**, then set **Intensity** to blend it in.',
            '**Secondary Qualifier** keys a correction to a range of hue, saturation, and luminance.',
            '**Power Window** limits a correction to an ellipse or rectangle mask with feather and invert.',
            'Add an **adjustment layer** to grade or apply effects to every clip on the tracks below it.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'LUT import requires a Chromium-based browser.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
