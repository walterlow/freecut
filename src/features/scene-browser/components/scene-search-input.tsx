import { useEffect, useRef } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/shared/ui/cn';
import { useSettingsStore, type CaptionSearchMode } from '../deps/settings';
import { useSceneBrowserStore } from '../stores/scene-browser-store';

export function SceneSearchInput() {
  const query = useSceneBrowserStore((s) => s.query);
  const setQuery = useSceneBrowserStore((s) => s.setQuery);
  const focusNonce = useSceneBrowserStore((s) => s.focusNonce);
  const captionSearchMode = useSettingsStore((s) => s.captionSearchMode);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusNonce]);

  const toggleMode = () => {
    const next: CaptionSearchMode = captionSearchMode === 'semantic' ? 'keyword' : 'semantic';
    setSetting('captionSearchMode', next);
  };

  const semanticActive = captionSearchMode === 'semantic';

  return (
    <div className="relative flex flex-1 min-w-0 items-center gap-1.5">
      <div className="relative flex-1 min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            semanticActive
              ? 'Search by meaning — "sunset over water", "people laughing"…'
              : 'Search scenes by what you see…'
          }
          className="h-8 pl-8 pr-7 text-[12px]"
          spellCheck={false}
          autoComplete="off"
        />
        {query.length > 0 && (
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
      <button
        type="button"
        onClick={toggleMode}
        className={cn(
          'flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
          semanticActive
            ? 'border-primary/60 bg-primary/10 text-primary'
            : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
        )}
        title={
          semanticActive
            ? 'Semantic search (by meaning) — click to switch to keyword'
            : 'Keyword search — click to switch to semantic'
        }
        aria-pressed={semanticActive}
      >
        <Sparkles className="h-3 w-3" />
        {semanticActive ? 'Semantic' : 'Keyword'}
      </button>
    </div>
  );
}
