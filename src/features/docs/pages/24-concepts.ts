import type { DocPageContent } from '../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'How FreeCut Works',
  description:
    'The mental model: local-first storage, projects and linked media, frames and timecode, and the GPU pipeline.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Local-first, by design',
      blocks: [
        {
          kind: 'list',
          items: [
            'FreeCut runs in your browser and stores everything in a **workspace folder** on your disk.',
            'Your original video and audio are **linked**, not copied or uploaded — FreeCut points to the files where they already live.',
            'Projects, caches, generated assets, and exports are written into the workspace, so you can back it up or move it like any folder.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Because media is linked, moving or renaming a source file shows up as **Missing Media** until you relink it. See [Workspaces and Storage](workspaces).',
        },
      ],
    },
    {
      title: 'Projects, tracks, and clips',
      blocks: [
        {
          kind: 'list',
          items: [
            'A **project** holds a timeline, its settings (resolution and frame rate), and references to the media you use.',
            'The timeline stacks **tracks**; higher tracks render over lower ones.',
            'A **clip** on the timeline is a window into a source file — trimming a clip changes which part of the source plays, it does not alter the file.',
            'Group a section into a **compound clip** to reuse it, and use an **adjustment layer** to affect every clip below it.',
          ],
        },
      ],
    },
    {
      title: 'Frames and timecode',
      blocks: [
        {
          kind: 'list',
          items: [
            'Timing is measured in **frames**. A clip has a start frame and a length in frames at the project frame rate.',
            'The preview shows **timecode**; click the readout in some views to switch to frame numbers.',
            'Source media can have a different frame rate than the project, so FreeCut converts source frames to project frames when you edit.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Set the project resolution and frame rate to match your delivery target when you create the project.',
        },
      ],
    },
    {
      title: 'Everything renders on your machine',
      blocks: [
        {
          kind: 'list',
          items: [
            'Playback, effects, color, and AI tools run locally using your GPU (WebGPU) and CPU (WebCodecs).',
            '**Proxies** are lighter copies of heavy media that make editing smooth; the final export always uses the originals.',
            'Because there is no cloud render, keeping the tab open during export matters — the render happens right in the browser.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
