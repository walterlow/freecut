import { createFileRoute, Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import {
  Layers,
  ArrowRight,
  Play,
  FolderOpen,
  Download,
  Star,
  ExternalLink,
  BookOpen,
} from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const showcaseItems = [
  {
    id: 'timeline',
    titleKey: 'projects.landing.showcase.timeline.title',
    descriptionKey: 'projects.landing.showcase.timeline.description',
    icon: Layers,
    media: '/assets/landing/timeline.png',
    className: 'md:col-span-2 md:row-span-1',
    aspectClass: 'aspect-[2/1]',
  },
  {
    id: 'keyframe',
    titleKey: 'projects.landing.showcase.keyframe.title',
    descriptionKey: 'projects.landing.showcase.keyframe.description',
    icon: Play,
    media: '/assets/landing/keyframe.png',
    className: 'md:row-span-2',
    aspectClass: 'aspect-[3/4] md:aspect-auto md:h-full',
  },
  {
    id: 'projects',
    titleKey: 'projects.landing.showcase.projects.title',
    descriptionKey: 'projects.landing.showcase.projects.description',
    icon: FolderOpen,
    media: '/assets/landing/projects.png',
    className: '',
    aspectClass: 'aspect-video',
  },
  {
    id: 'export',
    titleKey: 'projects.landing.showcase.export.title',
    descriptionKey: 'projects.landing.showcase.export.description',
    icon: Download,
    media: '/assets/landing/export.png',
    className: '',
    aspectClass: 'aspect-video',
  },
]

function LandingPage() {
  const { t } = useTranslation()
  const faqItems: Array<{ id?: string; question: string; answer: React.ReactNode }> = [
    {
      question: t('projects.landing.faq.free.question'),
      answer: t('projects.landing.faq.free.answer'),
    },
    {
      question: t('projects.landing.faq.install.question'),
      answer: t('projects.landing.faq.install.answer'),
    },
    {
      question: t('projects.landing.faq.storage.question'),
      answer: t('projects.landing.faq.storage.answer'),
    },
    {
      id: 'browser-support',
      question: t('projects.landing.faq.browsers.question'),
      answer: (
        <>
          <p className="mb-3">{t('projects.landing.faq.browsers.answerP1')}</p>
          <p>
            <Trans
              i18nKey="projects.landing.faq.browsers.answerP2"
              components={{
                strong: <strong />,
                code: <code className="rounded bg-muted px-1 py-0.5 text-xs" />,
              }}
            />
          </p>
        </>
      ),
    },
    {
      question: t('projects.landing.faq.exportFormats.question'),
      answer: t('projects.landing.faq.exportFormats.answer'),
    },
    {
      question: t('projects.landing.faq.future.question'),
      answer: t('projects.landing.faq.future.answer'),
    },
    {
      question: t('projects.landing.faq.shoutout.question'),
      answer: (
        <>
          <p className="mb-3">
            <Trans
              i18nKey="projects.landing.faq.shoutout.answerP1"
              components={{
                link: (
                  <a
                    href="https://mediabunny.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  />
                ),
              }}
            />
          </p>
          <p className="mb-2 font-medium text-foreground">
            {t('projects.landing.faq.shoutout.builtWith')}
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>React</li>
            <li>TypeScript</li>
            <li>Vite</li>
            <li>Shadcn</li>
          </ul>
        </>
      ),
    },
  ]
  return (
    <div className="min-h-screen bg-background text-foreground select-text">
      {/* Hero Section */}
      <section className="relative flex min-h-[60vh] flex-col items-center justify-center px-6 py-12">
        {/* Subtle gradient background */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col items-center text-center animate-fade-in">
          <div className="mb-6 flex items-center gap-3">
            <FreeCutLogo size="lg" />
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
              {t('projects.landing.beta')}
            </span>
          </div>

          <h1 className="mb-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            <Trans
              i18nKey="projects.landing.heroTitle"
              components={{ accent: <span className="text-primary" /> }}
            />
          </h1>

          <p className="mb-6 max-w-lg text-lg text-muted-foreground sm:text-xl">
            {t('projects.landing.heroSubtitle')}
          </p>

          <p className="mb-6 max-w-lg text-sm text-amber-600 dark:text-amber-500">
            {t('projects.landing.disclaimer')}
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                {t('projects.landing.getStarted')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link to="/docs">
                <BookOpen className="h-4 w-4" />
                Docs
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Star className="h-4 w-4" />
                {t('projects.landing.starOnGitHub')}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Showcase Bento Grid */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {t('projects.landing.showcaseHeading')}
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              {t('projects.landing.showcaseSubheading')}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2">
            {showcaseItems.map((item) => (
              <div
                key={item.id}
                className={`group relative overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-150 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${item.className}`}
              >
                {/* Media placeholder or actual media */}
                <div className={`relative ${item.aspectClass} w-full overflow-hidden bg-muted`}>
                  {item.media ? (
                    <img
                      src={item.media}
                      alt={t(item.titleKey)}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    /* Placeholder with icon */
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground/50">
                        <item.icon className="h-12 w-12" />
                        <span className="text-xs uppercase tracking-wider">
                          {t('projects.landing.screenshot')}
                        </span>
                      </div>
                      {/* Subtle grid pattern */}
                      <div
                        className="absolute inset-0 opacity-[0.03]"
                        style={{
                          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                                           linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
                          backgroundSize: '24px 24px',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Content overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/95 to-transparent p-4 pt-8">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{t(item.titleKey)}</h3>
                      <p className="text-xs text-muted-foreground">{t(item.descriptionKey)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Video Section */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {t('projects.landing.seeItInAction')}
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              {t('projects.landing.seeItInActionSubheading')}
            </p>
          </div>

          <a
            href="https://www.youtube.com/watch?v=2EWVUXpNntk"
            target="_blank"
            rel="noopener noreferrer"
            className="group block overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-colors hover:border-primary/50"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-muted">
              <img
                src="/assets/landing/timeline.png"
                alt={t('projects.landing.demoPreviewAlt')}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white shadow-2xl backdrop-blur-sm">
                  <Play className="ml-1 h-8 w-8 fill-current" />
                </div>
              </div>
              <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur-sm">
                <span>{t('projects.landing.watchDemoOnYouTube')}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </div>
          </a>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-t border-border bg-card/50 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {t('projects.landing.faqHeading')}
            </h2>
            <p className="text-muted-foreground">{t('projects.landing.faqSubheading')}</p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, index) => (
              <AccordionItem key={index} value={`item-${index}`} id={item.id}>
                <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="mb-4 text-2xl font-bold sm:text-3xl">
            {t('projects.landing.ctaHeading')}
          </h2>
          <p className="mb-8 text-muted-foreground">{t('projects.landing.ctaSubheading')}</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                {t('projects.landing.startEditing')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <Link to="/docs">
                <BookOpen className="h-4 w-4" />
                Docs
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Star className="h-4 w-4" />
                {t('projects.landing.starOnGitHub')}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto max-w-5xl text-center text-sm text-muted-foreground">
          {t('projects.landing.footer', { year: new Date().getFullYear() })}
        </div>
      </footer>
    </div>
  )
}
