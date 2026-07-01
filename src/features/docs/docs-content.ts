export type DocCategory = 'Start' | 'Core Editing' | 'Creative Tools' | 'Output' | 'Reference'

export interface DocFigure {
  /** Imported asset URL (import the image in the page module and pass it here). */
  src: string
  /** Required alt text for accessibility. */
  alt: string
  /** Optional caption shown under the image. */
  caption?: string
}

/**
 * Rich content blocks a section can render. Text in `paragraph`, `list`, `steps`,
 * and `note` supports inline markup: `**bold**` for UI labels and `` `code` `` for
 * keys and file names (see RichText in docs-shell).
 */
export type DocBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'note'; tone?: 'tip' | 'warning' | 'info'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'figure'; figure: DocFigure }

export interface DocSection {
  title: string
  /** Shorthand: rendered as a bullet list. Ignored when `blocks` is provided. */
  items?: string[]
  /** Richer content. Takes precedence over `items` when present. */
  blocks?: DocBlock[]
}

export interface DocPage {
  slug: string
  title: string
  description: string
  category: DocCategory
  sections: DocSection[]
  /** Slugs of related pages, shown as links at the foot of the article. */
  related?: string[]
}

export interface DocPageContent extends DocPage {
  order: number
}

type DocPageModule = { default: DocPageContent }

const pageModules = import.meta.glob<DocPageModule>('./pages/*.ts', { eager: true })

const orderedDocPageContent = Object.values(pageModules)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order)

export const DOC_PAGES: DocPage[] = orderedDocPageContent.map(({ order: _order, ...page }) => page)

export const DOC_GROUPS: DocCategory[] = [
  'Start',
  'Core Editing',
  'Creative Tools',
  'Output',
  'Reference',
]

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug)
}
