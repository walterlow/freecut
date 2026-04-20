import { useEffect, useRef } from 'react';
import { Check, ChevronDown, Palette, Search, Sparkles, Type, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/ui/cn';
import { useSettingsStore, type CaptionSearchMode } from '../deps/settings';
import { useSceneBrowserStore } from '../stores/scene-browser-store';
import { LibraryPaletteGrid } from './library-palette-grid';

/**
 * Row-1 toggles: Color mode, and (when not in color mode) the
 * semantic/keyword search-mode switch. Lifted out of the input field so
 * the scene browser header can keep all pill-shaped controls on one
 * line with the scope selector and the analyze menu, and push the
 * actual input surface to a second row.
 */
export function SceneSearchModeButtons({ compact = false }: { compact?: boolean }) {
  const colorMode = useSceneBrowserStore((s) => s.colorMode);
  const setColorMode = useSceneBrowserStore((s) => s.setColorMode);
  const captionSearchMode = useSettingsStore((s) => s.captionSearchMode);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const semanticActive = captionSearchMode === 'semantic';

  return (
    <>
      <button
        type="button"
        onClick={() => setColorMode(!colorMode)}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
          colorMode
            ? 'border-primary/60 bg-primary/10 text-primary'
            : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
        )}
        title={colorMode ? 'Exit color mode' : 'Search by color'}
        aria-label={colorMode ? 'Exit color mode' : 'Search by color'}
        aria-pressed={colorMode}
      >
        <Palette className="h-3 w-3" />
        {!compact && 'Color'}
      </button>
      {!colorMode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
                semanticActive
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
              )}
              title={
                semanticActive
                  ? 'Semantic search (by meaning)'
                  : 'Keyword search (exact match)'
              }
              aria-label={semanticActive ? 'Semantic search' : 'Keyword search'}
            >
              {semanticActive ? <Sparkles className="h-3 w-3" /> : <Type className="h-3 w-3" />}
              {!compact && (semanticActive ? 'Semantic' : 'Keyword')}
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => setSetting('captionSearchMode', 'keyword' satisfies CaptionSearchMode)}>
              <Type className="mr-2 h-3 w-3" />
              <div className="flex flex-col">
                <span>Keyword</span>
                <span className="text-[10px] text-muted-foreground">Exact word matches</span>
              </div>
              {!semanticActive && <Check className="ml-auto h-3 w-3" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSetting('captionSearchMode', 'semantic' satisfies CaptionSearchMode)}>
              <Sparkles className="mr-2 h-3 w-3" />
              <div className="flex flex-col">
                <span>Semantic</span>
                <span className="text-[10px] text-muted-foreground">Match by meaning</span>
              </div>
              {semanticActive && <Check className="ml-auto h-3 w-3" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

/**
 * Row-2 input surface: text search when in caption-search mode, palette
 * grid when in color mode. Sized to fill the browser header's second
 * row on its own.
 */
export function SceneSearchField() {
  const query = useSceneBrowserStore((s) => s.query);
  const setQuery = useSceneBrowserStore((s) => s.setQuery);
  const focusNonce = useSceneBrowserStore((s) => s.focusNonce);
  const reference = useSceneBrowserStore((s) => s.reference);
  const setReference = useSceneBrowserStore((s) => s.setReference);
  const colorMode = useSceneBrowserStore((s) => s.colorMode);
  const scope = useSceneBrowserStore((s) => s.scope);
  const captionSearchMode = useSettingsStore((s) => s.captionSearchMode);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusNonce]);

  const semanticActive = captionSearchMode === 'semantic';

  if (colorMode) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1.5">
        {reference ? (
          <button
            type="button"
            onClick={() => setReference(null)}
            className="flex h-6 max-w-[220px] items-center gap-1 rounded-md border border-primary/60 bg-primary/10 px-2 text-[11px] text-primary transition-colors hover:bg-primary/20"
            title="Clear reference and pick another color"
          >
            <Palette className="h-3 w-3 shrink-0" />
            <span className="truncate">{reference.label}</span>
            <X className="h-3 w-3 shrink-0" />
          </button>
        ) : (
          <LibraryPaletteGrid scope={scope} />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <div className="relative flex-1 min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            reference
              ? 'Finding scenes with a similar palette…'
              : semanticActive
                ? 'Search by meaning — "sunset over water", "people laughing"…'
                : 'Search scenes by what you see…'
          }
          disabled={!!reference}
          className="h-8 pl-8 pr-7 text-[12px] disabled:opacity-60"
          spellCheck={false}
          autoComplete="off"
        />
        {query.length > 0 && !reference && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {reference && (
        <button
          type="button"
          onClick={() => setReference(null)}
          className="flex h-8 max-w-[220px] items-center gap-1 rounded-md border border-primary/60 bg-primary/10 px-2 text-[11px] text-primary transition-colors hover:bg-primary/20"
          title={`Similar palette to ${reference.label} — click to clear`}
        >
          <Palette className="h-3 w-3 shrink-0" />
          <span className="truncate">{reference.label}</span>
          <X className="h-3 w-3 shrink-0" />
        </button>
      )}
    </div>
  );
}
