import type { DocPageContent } from '../docs-content'

const page = {
  order: 19,
  slug: 'render-queue',
  title: 'Render Queue',
  description:
    'Queue multiple exports, split a render into segments, manage the queue, and find saved files.',
  category: 'Output',
  related: ['export'],
  sections: [
    {
      title: 'Queue exports',
      blocks: [
        {
          kind: 'list',
          items: [
            'From the Export dialog, choose **Add to queue** instead of rendering right away.',
            'Queue the whole project or the current range.',
            'Open the queue any time from the **Render queue** button in the toolbar, which shows a live job count.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Queued exports render one at a time and save to the exports folder in your workspace.',
        },
      ],
    },
    {
      title: 'Split into segments',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Split into segments** turns one render into several jobs.',
            'Use **One segment per marker** to break the render at your timeline markers.',
            'Or split into fixed chunks of a set number of seconds.',
          ],
        },
      ],
    },
    {
      title: 'Manage the queue',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Pause** and **Resume** the queue to control when rendering happens.',
            'Move a queued job **Up** or **Down** to change its order.',
            '**Cancel** a running or queued job, **Retry** a failed one, and **Remove** finished jobs.',
            'Job status reads Queued, Rendering, Done, Failed, or Cancelled; use **Clear finished** or **Clear all** to tidy up.',
          ],
        },
      ],
    },
    {
      title: 'Saved exports',
      blocks: [
        {
          kind: 'list',
          items: [
            'Switch to the **Saved exports** tab to see completed files.',
            'Download or Delete a saved export from there.',
            'The files live in this project folder inside your workspace.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
