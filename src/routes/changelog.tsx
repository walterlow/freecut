import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CalendarDays, Plus, Sparkles, Wrench } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import changelogData from '@/data/changelog.json'
import type { ChangelogEntry, ChangelogFile, ChangelogGroup } from '@/data/changelog-types'

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
})

const groupIcons = {
  added: Plus,
  fixed: Wrench,
  improved: Sparkles,
}

const groupLabelKeys: Record<ChangelogGroup, string> = {
  added: 'editor.whatsNew.groupAdded',
  fixed: 'editor.whatsNew.groupFixed',
  improved: 'editor.whatsNew.groupImproved',
}

const data = changelogData as ChangelogFile
const releases: ChangelogEntry[] = data.current ? [data.current, ...data.releases] : data.releases
const groupOrder: ChangelogGroup[] = ['added', 'fixed', 'improved']

function formatSingleDate(iso: string, language?: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatWeekRange(mondayIso: string, language?: string): string {
  const monday = new Date(`${mondayIso}T00:00:00Z`)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  const formatter = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' })
  return `${formatter.format(monday)} — ${formatter.format(sunday)}`
}

function formatReleasePeriod(release: ChangelogEntry, t: TFunction, language?: string): string {
  if (release.subtitleKey) return t(`changelog.${release.subtitleKey}`)
  if (release.version === 'current') {
    return t('editor.whatsNew.asOf', { date: formatSingleDate(release.date, language) })
  }
  return t('editor.whatsNew.weekOf', { range: formatWeekRange(release.date, language) })
}

function getChangeCount(release: ChangelogEntry): number {
  return groupOrder.reduce((count, group) => count + (release.groups[group]?.length ?? 0), 0)
}

function formatChangeCount(count: number, t: TFunction): string {
  return t('changelog.changeCount', { count })
}

function getReleaseMarkerClass(isLatest: boolean): string {
  return isLatest ? 'h-4 w-4 bg-primary sm:h-6 sm:w-6' : 'h-4 w-4 bg-muted'
}

function ChangelogReleaseTitle({
  release,
  isLatest,
}: {
  release: ChangelogEntry
  isLatest: boolean
}) {
  const { t } = useTranslation()
  const label = release.version === 'current' ? t('editor.whatsNew.thisWeek') : release.version

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <h2 className="text-xl font-semibold tracking-tight">{label}</h2>
      {isLatest && (
        <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          {t('changelog.latest')}
        </span>
      )}
    </div>
  )
}

function ChangelogGroupSection({
  group,
  items,
}: {
  group: ChangelogGroup
  items: ChangelogEntry['groups'][ChangelogGroup]
}) {
  const { t } = useTranslation()
  if (!items?.length) return null

  const GroupIcon = groupIcons[group]
  return (
    <section className="bg-card px-5 py-6 sm:px-7">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <GroupIcon className="h-3.5 w-3.5" />
        </span>
        {t(groupLabelKeys[group])}
      </h3>
      <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item.title} className="flex gap-2.5">
            <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ChangelogRelease({ release, index }: { release: ChangelogEntry; index: number }) {
  const { t, i18n } = useTranslation()
  const isLatest = index === 0
  const changeCount = getChangeCount(release)

  return (
    <div className="relative pl-8 sm:pl-12">
      <div
        className={`absolute left-0 top-7 z-10 rounded-full border-4 border-background ${getReleaseMarkerClass(
          isLatest,
        )}`}
      />
      <details
        open={isLatest}
        className="group overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm open:border-primary/30 open:shadow-lg open:shadow-primary/5"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 marker:hidden sm:px-7 [&::-webkit-details-marker]:hidden">
          <div>
            <ChangelogReleaseTitle release={release} isLatest={isLatest} />
            <p className="mt-1 text-sm text-muted-foreground">
              {formatReleasePeriod(release, t, i18n.resolvedLanguage)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{formatChangeCount(changeCount, t)}</span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
          </div>
        </summary>

        <div className="grid gap-px border-t border-border bg-border md:grid-cols-3">
          {groupOrder.map((group) => (
            <ChangelogGroupSection key={group} group={group} items={release.groups[group]} />
          ))}
        </div>
      </details>
    </div>
  )
}

function ChangelogPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_68%)]" />

      <header className="relative border-b border-border/70 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link to="/" aria-label={t('changelog.homeAria')}>
            <FreeCutLogo size="md" />
          </Link>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              {t('changelog.backToHome')}
            </Link>
          </Button>
        </div>
      </header>

      <main className="relative px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 max-w-3xl">
            <div className="mb-5 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-primary">
              <CalendarDays className="h-4 w-4" />
              {t('changelog.releaseNotes')}
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              {t('changelog.title')}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              {t('changelog.description')}
            </p>
          </div>

          <div className="relative space-y-5 before:absolute before:bottom-8 before:left-[7px] before:top-8 before:w-px before:bg-border sm:before:left-[11px]">
            {releases.map((release, index) => (
              <ChangelogRelease key={release.version} release={release} index={index} />
            ))}
          </div>

          <div className="mt-16 flex flex-col items-start justify-between gap-5 rounded-xl border border-border bg-card px-6 py-7 sm:flex-row sm:items-center sm:px-8">
            <div>
              <h2 className="text-xl font-semibold">{t('changelog.ctaTitle')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('changelog.ctaDescription')}</p>
            </div>
            <Button asChild className="gap-2">
              <Link to="/projects">
                {t('changelog.openFreeCut')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
