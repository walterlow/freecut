import { createFileRoute, Link } from '@tanstack/react-router';
import { Layers, ArrowRight, Play, FolderOpen, Download, Star } from 'lucide-react';
import { FreeCutLogo } from '@/components/brand/freecut-logo';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export const Route = createFileRoute('/')({
  component: LandingPage,
});

const faqItems = [
  {
    question: 'Is FreeCut really free?',
    answer: 'Yes, FreeCut is completely free and open source under the MIT license. There are no hidden fees, subscriptions, or watermarks.',
  },
  {
    question: 'Do I need to install anything?',
    answer: 'No installation required. FreeCut runs entirely in your browser. Just open the website and start editing.',
  },
  {
    question: 'Where are my videos stored?',
    answer: 'Your videos and projects are stored locally in your browser or referenced to your local files using modern storage APIs.',
  },
  {
    question: 'What browsers are supported?',
    answer: 'FreeCut currently supports Google Chrome version 102+. We use modern browser APIs like WebCodecs and File System Access which have limited cross-browser support.',
  },
  {
    question: 'What export formats are supported?',
    answer: 'Video: MP4, MOV, WebM, MKV. Audio: MP3, AAC, WAV. Multiple codecs (H.264, H.265, VP8, VP9) and quality settings available.',
  },
  {
    question: 'Future Improvements',
    answer: 'Will add features as I see fit and based on feedback. Maybe come up with a roadmap or something.',
  },
  {
    question: 'Special shoutout',
    answer: (
      <>
        <p className="mb-3">
          A huge thank you to{' '}
          <a href="https://www.remotion.dev/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
            Remotion
          </a>{' '}
          for their incredible video composition framework and{' '}
          <a href="https://mediabunny.dev/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
            Mediabunny
          </a>{' '}
          for making browser-based video encoding easy. This project wouldn't exist without their amazing work!
        </p>
        <p className="mb-2 font-medium text-foreground">Built with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>React</li>
          <li>TypeScript</li>
          <li>Vite</li>
          <li>Shadcn</li>
        </ul>
      </>
    ),
  },
];

const showcaseItems = [
  {
    id: 'timeline',
    title: 'Timeline Editing',
    description: 'Multi-track editing with video, audio, text, and shapes',
    icon: Layers,
    media: '/assets/landing/timeline.png',
    className: 'md:col-span-2 md:row-span-1',
    aspectClass: 'aspect-[2/1]',
  },
  {
    id: 'keyframe',
    title: 'Simple KeyFrame Editor',
    description: 'Intuitive keyframe animation for smooth transitions',
    icon: Play,
    media: '/assets/landing/keyframe.png',
    className: 'md:row-span-2',
    aspectClass: 'aspect-[3/4] md:aspect-auto md:h-full',
  },
  {
    id: 'projects',
    title: 'Project Management',
    description: 'Create, organize, and manage your projects',
    icon: FolderOpen,
    media: '/assets/landing/projects.png',
    className: '',
    aspectClass: 'aspect-video',
  },
  {
    id: 'export',
    title: 'Export on the Web',
    description: 'Render your videos locally with your browser.',
    icon: Download,
    media: '/assets/landing/export.png',
    className: '',
    aspectClass: 'aspect-video',
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
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
              Beta
            </span>
          </div>

          <h1 className="mb-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Edit videos.{' '}
            <span className="text-primary">In your browser.</span>
          </h1>

          <p className="mb-6 max-w-lg text-lg text-muted-foreground sm:text-xl">
            Professional video editing, zero installation.
            Create stunning content in your browser.
          </p>

          <p className="mb-6 max-w-lg text-sm text-amber-600 dark:text-amber-500">
            ⚠️ DISCLAIMER: This is very much in beta and might be buggy. I hope you still enjoy the experience.  
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Star className="h-4 w-4" />
                Star on GitHub
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
              Multi featured editing capabilities
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              A complete video editing suite, right in your browser.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3 md:grid-rows-2">
            {showcaseItems.map((item) => (
              <div
                key={item.id}
                className={`group relative overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${item.className}`}
              >
                {/* Media placeholder or actual media */}
                <div className={`relative ${item.aspectClass} w-full overflow-hidden bg-muted`}>
                  {item.media ? (
                    <img
                      src={item.media}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    /* Placeholder with icon */
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground/50">
                        <item.icon className="h-12 w-12" />
                        <span className="text-xs uppercase tracking-wider">Screenshot</span>
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
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-t border-border bg-card/50 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Frequently Asked Questions
            </h2>
            <p className="text-muted-foreground">
              Everything you need to know about FreeCut.
            </p>
          </div>

          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="mb-4 text-2xl font-bold sm:text-3xl">
            Ready to start editing?
          </h2>
          <p className="mb-8 text-muted-foreground">
            Jump in and create your first project in seconds.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-2 px-8">
              <Link to="/projects">
                Start Editing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg" className="gap-2">
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Star className="h-4 w-4" />
                Star on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto max-w-5xl text-center text-sm text-muted-foreground">
          MIT License © {new Date().getFullYear()} FreeCut
        </div>
      </footer>
    </div>
  );
}
