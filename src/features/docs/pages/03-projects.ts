import type { DocPageContent } from '../docs-content'

const page = {
  order: 3,
  slug: 'projects',
  title: 'Projects',
  description: 'Create, configure, duplicate, organize, trash, restore, and move projects.',
  category: 'Start',
  related: ['workspaces', 'editor'],
  sections: [
    {
      title: 'Create and configure a project',
      blocks: [
        {
          kind: 'list',
          items: [
            'Create a project from the Projects page with **New Project**.',
            'Set the project name, description, resolution, frame rate, and background color.',
            'Resolution and frame rate define the export canvas and timeline timing, so pick them to match your target delivery.',
            'You can revisit project specs later from the editor toolbar.',
          ],
        },
      ],
    },
    {
      title: 'Organize the project list',
      blocks: [
        {
          kind: 'list',
          items: [
            'Search projects by name, and sort or filter the list as it grows.',
            'Use thumbnails and metadata to spot the project you last worked on.',
            'The active workspace is shown on the Projects page, so you always know where projects are stored.',
            'Use **Duplicate** to branch a variation without touching the original.',
          ],
        },
      ],
    },
    {
      title: 'Trash and restore',
      blocks: [
        {
          kind: 'list',
          items: [
            'Deleting a project moves it to **Trash** rather than removing it immediately.',
            'Restore a project from the Trash section while it is still there.',
            '**Empty trash** permanently deletes trashed projects and any media they exclusively reference.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Permanent deletion cannot be undone, so confirm the name before emptying trash.',
        },
      ],
    },
    {
      title: 'Move work between workspaces',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Export Project** to create a bundle that packages the project with its media.',
            'Import a bundle into another workspace to continue the same edit on a different machine or folder.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bundles are the safe way to hand a project to someone else, because they carry the linked media along with the timeline.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
