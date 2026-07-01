import type { DocPageContent } from '../docs-content'

const page = {
  order: 12,
  slug: 'audio',
  title: 'Audio Editing',
  description:
    'Clip gain and fades, pitch, per-clip EQ, the mixer and meters, and silence and filler-word cleanup.',
  category: 'Creative Tools',
  related: ['properties', 'local-ai'],
  sections: [
    {
      title: 'Adjust a clip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Select a clip and open the **Audio** tab in Properties.',
        },
        {
          kind: 'table',
          headers: ['Control', 'Range'],
          rows: [
            ['Gain', '-60 dB to +12 dB (−60 dB effectively mutes the clip)'],
            ['Fade In / Fade Out', '0 to 5 seconds each'],
            ['Pitch', 'Semi Tones and Cents, independent of speed'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'You can also drag the volume line and fade handles directly on the clip in the timeline, and **Gain** can be keyframed to rise or fall over a clip.',
        },
      ],
    },
    {
      title: 'Pitch and tone',
      blocks: [
        {
          kind: 'list',
          items: [
            'The **Pitch** controls shift pitch without changing clip speed. To change speed instead, use **Speed** on the Video tab.',
            'The **Equalizer** section gives each clip a curve editor for tonal shaping.',
          ],
        },
      ],
    },
    {
      title: 'Mixer and meters',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open the audio **Meters** to watch stereo levels and catch clipping while you play.',
            'Use the **Mixer** to balance levels across the project.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Monitor volume in the preview affects local playback only and never changes the exported mix.',
        },
      ],
    },
    {
      title: 'Clean up dialogue',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Remove Silence** finds silent ranges and cuts them; the **Minimum Silence** setting controls how long a gap must be, and the dialog estimates how much will be removed.',
            '**Remove Filler Words** detects words like um and uh from the transcript and audio and removes them.',
            'Both tools show the ranges they will remove so you can preview before applying the edit.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A transcript improves filler-word detection, so generate one first for the best results.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
