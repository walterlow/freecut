import { Link } from '@tanstack/react-router'
import type React from 'react'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Info,
  Lightbulb,
  Search,
} from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import {
  DOC_GROUPS,
  DOC_PAGES,
  getDocPage,
  type DocBlock,
  type DocCategory,
  type DocPage,
  type DocSection,
} from './docs-content'

/** Free-text haystack for a page, used by the sidebar search filter. */
function pageSearchText(page: DocPage): string {
  const parts = [page.title, page.description]
  for (const section of page.sections) {
    parts.push(section.title)
    if (section.items) parts.push(...section.items)
    for (const block of section.blocks ?? []) {
      if (block.kind === 'paragraph' || block.kind === 'note') parts.push(block.text)
      else if (block.kind === 'list' || block.kind === 'steps') parts.push(...block.items)
      else if (block.kind === 'table') parts.push(...block.headers, ...block.rows.flat())
    }
  }
  return parts.join(' ').toLowerCase()
}

interface DocsShellProps {
  children: React.ReactNode
  currentSlug?: string
}

export function DocsShell({ children, currentSlug }: DocsShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <FreeCutLogo size="md" />
            <span className="hidden text-sm text-muted-foreground sm:inline">Docs</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">Open FreeCut</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Home</Link>
            </Button>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <DocsNavigation currentSlug={currentSlug} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}

function DocsNavigation({ currentSlug }: { currentSlug?: string }) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!trimmed) return null
    return new Set(
      DOC_PAGES.filter((page) => pageSearchText(page).includes(trimmed)).map((p) => p.slug),
    )
  }, [trimmed])

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs"
          aria-label="Search documentation"
          className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-2 text-sm outline-none focus:border-primary/60"
        />
      </div>

      <Link
        to="/docs"
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent',
          !currentSlug && 'bg-accent text-primary',
        )}
      >
        <BookOpen className="h-4 w-4" />
        Docs overview
      </Link>

      {matches?.size === 0 && (
        <p className="px-2 text-sm text-muted-foreground">No pages match “{query.trim()}”.</p>
      )}

      {DOC_GROUPS.map((group) => {
        const pages = DOC_PAGES.filter(
          (page) => page.category === group && (matches === null || matches.has(page.slug)),
        )
        if (pages.length === 0) return null

        return (
          <div key={group} className="space-y-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">{group}</p>
            {pages.map((page) => (
              <Link
                key={page.slug}
                to="/docs/$slug"
                params={{ slug: page.slug }}
                className={cn(
                  'block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
                  currentSlug === page.slug && 'bg-accent text-foreground',
                )}
              >
                {page.title}
              </Link>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function DocsHome() {
  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="mb-4 flex items-center gap-2 text-primary">
          <BookOpen className="h-5 w-5" />
          <span className="text-sm font-medium">FreeCut documentation</span>
        </div>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          FreeCut User Guide
        </h1>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Start with setup, workspaces, media import, timeline editing, and export. Use the
          reference pages when you need a precise control, shortcut, or troubleshooting path.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/docs/$slug" params={{ slug: 'getting-started' }}>
              Start editing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/docs/$slug" params={{ slug: 'troubleshooting' }}>
              Fix a problem
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {(
          [
            ['Start', 'Set up the browser, workspace, projects, and editor layout.'],
            [
              'Core Editing',
              'Import media, cut on the timeline, preview, and adjust clip properties.',
            ],
            [
              'Creative Tools',
              'Text, shapes and masks, audio, effects, color, transitions, keyframes, animation, scenes, and local AI.',
            ],
            ['Output', 'Export files from the browser and manage queued renders.'],
          ] satisfies [DocCategory, string][]
        ).map(([title, description]) => (
          <div key={title} className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <div className="mt-4 space-y-1">
              {DOC_PAGES.filter((page) => page.category === title).map((page) => (
                <Link
                  key={page.slug}
                  to="/docs/$slug"
                  params={{ slug: page.slug }}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  {page.title}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Reference</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_PAGES.filter((page) => page.category === 'Reference').map((page) => (
            <Link
              key={page.slug}
              to="/docs/$slug"
              params={{ slug: page.slug }}
              className="rounded-md border border-border bg-background p-3 hover:border-primary/60"
            >
              <p className="text-sm font-medium">{page.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{page.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export function DocsArticle({ page }: { page: DocPage }) {
  const index = DOC_PAGES.findIndex((candidate) => candidate.slug === page.slug)
  const previous = index > 0 ? DOC_PAGES[index - 1] : undefined
  const next = index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined

  return (
    <article className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-6 sm:p-8">
        <Link
          to="/docs"
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Docs
        </Link>
        <p className="text-sm font-medium text-primary">{page.category}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">{page.description}</p>
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        {page.sections.map((section, sectionIndex) => (
          <section key={sectionIndex}>
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <SectionBody section={section} />
          </section>
        ))}

        <RelatedPages slugs={page.related} />
      </div>

      <footer className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
        {previous ? (
          <Button asChild variant="outline" className="justify-start">
            <Link to="/docs/$slug" params={{ slug: previous.slug }}>
              <ArrowLeft className="h-4 w-4" />
              {previous.title}
            </Link>
          </Button>
        ) : (
          <div />
        )}
        {next && (
          <Button asChild variant="outline" className="justify-end">
            <Link to="/docs/$slug" params={{ slug: next.slug }}>
              {next.title}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </footer>
    </article>
  )
}

function SectionBody({ section }: { section: DocSection }) {
  const blocks: DocBlock[] =
    section.blocks ?? (section.items ? [{ kind: 'list', items: section.items }] : [])

  return (
    <div className="mt-3 space-y-4 text-sm leading-6 text-muted-foreground">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          <RichText text={block.text} />
        </p>
      )

    case 'list':
      return (
        <ul className="list-disc space-y-2 pl-5">
          {block.items.map((item, index) => (
            <li key={index}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      )

    case 'steps':
      return (
        <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-foreground">
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <RichText text={item} />
            </li>
          ))}
        </ol>
      )

    case 'note':
      return <Note tone={block.tone ?? 'info'} text={block.text} />

    case 'table':
      return <Table headers={block.headers} rows={block.rows} />

    case 'figure':
      return <Figure figure={block.figure} />
  }
}

const NOTE_STYLES = {
  tip: {
    icon: Lightbulb,
    className: 'border-emerald-500/30 bg-emerald-500/5',
    iconClass: 'text-emerald-500',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-500/30 bg-amber-500/5',
    iconClass: 'text-amber-500',
  },
  info: { icon: Info, className: 'border-primary/30 bg-primary/5', iconClass: 'text-primary' },
} as const

function Note({ tone, text }: { tone: 'tip' | 'warning' | 'info'; text: string }) {
  const { icon: Icon, className, iconClass } = NOTE_STYLES[tone]

  return (
    <div className={cn('flex gap-3 rounded-md border p-3', className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
      <p>
        <RichText text={text} />
      </p>
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {headers.map((header, index) => (
              <th key={index} className="px-3 py-2 font-medium text-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top">
                  <RichText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Figure({ figure }: { figure: { src: string; alt: string; caption?: string } }) {
  return (
    <figure className="space-y-2">
      <img
        src={figure.src}
        alt={figure.alt}
        loading="lazy"
        className="w-full rounded-lg border border-border"
      />
      {figure.caption && (
        <figcaption className="text-xs text-muted-foreground">{figure.caption}</figcaption>
      )}
    </figure>
  )
}

/** Renders inline `**bold**`, `` `code` ``, and `[text](page-slug)` links inside doc strings. */
function RichText({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean)

  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith('**') && token.endsWith('**')) {
          return (
            <strong key={index} className="font-medium text-foreground">
              {token.slice(2, -2)}
            </strong>
          )
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <kbd
              key={index}
              className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
            >
              {token.slice(1, -1)}
            </kbd>
          )
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
        if (link) {
          const [, label, slug] = link
          return (
            <Link
              key={index}
              to="/docs/$slug"
              params={{ slug: slug as string }}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {label}
            </Link>
          )
        }
        return <span key={index}>{token}</span>
      })}
    </>
  )
}

function RelatedPages({ slugs }: { slugs?: string[] }) {
  const related = (slugs ?? []).map(getDocPage).filter((page): page is DocPage => Boolean(page))
  if (related.length === 0) return null

  return (
    <section className="border-t border-border pt-6">
      <h2 className="text-xl font-semibold">Related</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {related.map((page) => (
          <Link
            key={page.slug}
            to="/docs/$slug"
            params={{ slug: page.slug }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:border-primary/60"
          >
            {page.title}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  )
}
