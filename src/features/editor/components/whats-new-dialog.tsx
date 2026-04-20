import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Sparkles, Bug, Zap, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/shared/ui/cn';
import changelogData from '@/data/changelog.json';
import type {
  ChangelogEntry,
  ChangelogFile,
  ChangelogGroup,
} from '@/data/changelog-types';
import { markChangelogSeen } from './whats-new-seen';

const data = changelogData as ChangelogFile;
const GITHUB_REPO_URL = 'https://github.com/walterlow/freecut';

const GROUP_CONFIG: Record<
  ChangelogGroup,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  added: { label: 'Added', icon: Sparkles },
  fixed: { label: 'Fixed', icon: Bug },
  improved: { label: 'Improved', icon: Zap },
};

const GROUP_ORDER: ChangelogGroup[] = ['added', 'fixed', 'improved'];

function formatEntryLabel(entry: ChangelogEntry): string {
  return entry.version === 'current' ? 'This Week' : entry.version;
}

function formatWeekRange(mondayIso: string): string {
  const monday = new Date(`${mondayIso}T00:00:00Z`);
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${fmt.format(monday)} — ${fmt.format(sunday)}`;
}

function formatEntrySubtitle(entry: ChangelogEntry): string {
  if (entry.subtitle) return entry.subtitle;
  if (entry.version === 'current') return `As of ${formatSingleDate(entry.date)}`;
  return `Week of ${formatWeekRange(entry.date)}`;
}

function formatSingleDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const entries = useMemo<ChangelogEntry[]>(
    () => (data.current ? [data.current, ...data.releases] : data.releases),
    [],
  );

  const [selectedVersion, setSelectedVersion] = useState<string>(
    () => entries[0]?.version ?? '',
  );

  useEffect(() => {
    if (open) markChangelogSeen();
  }, [open]);

  const selected = entries.find((e) => e.version === selectedVersion) ?? entries[0];
  const latestReleaseVersion = data.releases[0]?.version;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[72vh] p-0 flex flex-col overflow-hidden gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            What's New
          </DialogTitle>
        </DialogHeader>
        <Separator />
        <div className="flex flex-1 overflow-hidden min-h-0">
          <nav className="w-56 border-r shrink-0 bg-muted/20">
            <ScrollArea className="h-full">
              <ul className="p-2 space-y-0.5">
                {entries.map((entry) => {
                  const isCurrent = entry.version === 'current';
                  const isSelected = selectedVersion === entry.version;
                  return (
                    <li key={entry.version}>
                      <button
                        type="button"
                        onClick={() => setSelectedVersion(entry.version)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {formatEntryLabel(entry)}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                              New
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {formatEntrySubtitle(entry)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </nav>
          <ScrollArea className="flex-1 min-w-0">
            {selected && <ChangelogEntryView entry={selected} />}
          </ScrollArea>
        </div>
        <Separator />
        <div className="px-6 py-3 flex justify-between items-center text-xs text-muted-foreground">
          <span>{latestReleaseVersion ? `Released: v${latestReleaseVersion}` : 'Pre-release'}</span>
          <a
            href={`${GITHUB_REPO_URL}/blob/main/CHANGELOG.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground hover:underline"
          >
            Full changelog
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangelogEntryView({ entry }: { entry: ChangelogEntry }) {
  return (
    <div className="px-6 py-5 space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{formatEntryLabel(entry)}</h2>
        <p className="text-sm text-muted-foreground">{formatEntrySubtitle(entry)}</p>
      </header>

      {entry.highlights && entry.highlights.length > 0 && (
        <section className="rounded-lg border bg-primary/5 p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
            Highlights
          </h3>
          <ul className="space-y-1.5">
            {entry.highlights.map((highlight, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {GROUP_ORDER.map((groupKey) => {
        const items = entry.groups[groupKey];
        if (!items || items.length === 0) return null;
        const { label, icon: Icon } = GROUP_CONFIG[groupKey];
        return (
          <section key={groupKey} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </h3>
            <ul className="space-y-1.5 pl-6">
              {items.map((item, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-muted-foreground shrink-0">•</span>
                  <span>
                    {item.scope && (
                      <span className="text-xs text-muted-foreground font-mono mr-1.5">
                        {item.scope}
                      </span>
                    )}
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
