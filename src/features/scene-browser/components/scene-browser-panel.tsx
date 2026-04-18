import { useCallback, useMemo } from 'react';
import { ArrowLeft, BrainCircuit, Eye, Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/shared/ui/cn';
import { useMediaLibraryStore } from '../deps/media-library';
import { useSettingsStore } from '../deps/settings';
import { useSceneBrowserStore, type SceneBrowserSortMode } from '../stores/scene-browser-store';
import { useRankedScenes } from '../hooks/use-ranked-scenes';
import { useSemanticIndex } from '../hooks/use-semantic-index';
import { SceneSearchInput } from './scene-search-input';
import { SceneRow } from './scene-row';

interface SceneBrowserPanelProps {
  className?: string;
}

const SORT_OPTIONS: Array<{ value: SceneBrowserSortMode; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'time', label: 'Timestamp' },
  { value: 'name', label: 'Media name' },
];

export function SceneBrowserPanel({ className }: SceneBrowserPanelProps) {
  const closeBrowser = useSceneBrowserStore((s) => s.closeBrowser);
  const query = useSceneBrowserStore((s) => s.query);
  const scope = useSceneBrowserStore((s) => s.scope);
  const setScope = useSceneBrowserStore((s) => s.setScope);
  const sortMode = useSceneBrowserStore((s) => s.sortMode);
  const setSortMode = useSceneBrowserStore((s) => s.setSortMode);

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const mediaWithCaptions = useMemo(
    () => mediaItems.filter((m) => (m.aiCaptions?.length ?? 0) > 0),
    [mediaItems],
  );

  const {
    scenes,
    totalScenes,
    clipsWithCaptions,
    reanalyzingMedia,
    activeMode,
    isQuerying,
    sceneTextIndexed,
    sceneImageIndexed,
    queryTextEmbedding,
    queryImageEmbedding,
  } = useRankedScenes();
  const indexProgress = useSemanticIndex();
  const captionSearchMode = useSettingsStore((s) => s.captionSearchMode);

  const scopedMedia = useMemo(
    () => (scope ? mediaWithCaptions.find((m) => m.id === scope) ?? null : null),
    [scope, mediaWithCaptions],
  );

  const handleScopeChange = useCallback((value: string) => {
    setScope(value === 'all' ? null : value);
  }, [setScope]);

  const showMediaName = scope === null;
  const hasAnyCaptions = totalScenes > 0;
  const hasResults = scenes.length > 0;
  const isFiltered = query.trim().length > 0;

  const scopeLabel = scopedMedia
    ? `${clipsWithCaptions} clip · ${totalScenes} ${totalScenes === 1 ? 'scene' : 'scenes'}`
    : `${clipsWithCaptions} ${clipsWithCaptions === 1 ? 'clip' : 'clips'} · ${totalScenes} ${totalScenes === 1 ? 'scene' : 'scenes'}`;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={closeBrowser}
          aria-label="Back to media library"
          title="Back to media library"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <SceneSearchInput />
        <Select value={scope ?? 'all'} onValueChange={handleScopeChange}>
          <SelectTrigger className="h-8 w-36 text-[11px]">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All media</SelectItem>
            {mediaWithCaptions.map((media) => (
              <SelectItem key={media.id} value={media.id}>
                {media.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-purple-400" />
          {isFiltered
            ? `${scenes.length} ${scenes.length === 1 ? 'match' : 'matches'} · ${scopeLabel}`
            : scopeLabel}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground/80">Sort</span>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SceneBrowserSortMode)}>
            <SelectTrigger className="h-6 w-28 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {captionSearchMode === 'semantic' && (
        <SemanticStatusBar
          totalScenes={totalScenes}
          textIndexed={sceneTextIndexed}
          imageIndexed={sceneImageIndexed}
          queryTextEmbedding={queryTextEmbedding}
          queryImageEmbedding={queryImageEmbedding}
          activeMode={activeMode}
          isQuerying={isQuerying}
          indexing={indexProgress.indexTotal > 0 || indexProgress.loadingModel}
        />
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-0.5 px-2 py-2">
          {reanalyzingMedia.length > 0 && (
            <ReanalyzingBanner items={reanalyzingMedia} />
          )}
          {(indexProgress.indexTotal > 0 || indexProgress.loadingModel) && (
            <SemanticIndexBanner progress={indexProgress} />
          )}
          {hasResults ? (
            scenes.map((scene, index) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                showMediaName={showMediaName}
                showSignals={isQuerying}
                isTop={isQuerying && index === 0}
              />
            ))
          ) : reanalyzingMedia.length === 0 ? (
            <EmptyState hasAnyCaptions={hasAnyCaptions} isFiltered={isFiltered} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Thin sub-header shown only while Semantic mode is active. Makes every
 * moving part of the pipeline legible at a glance:
 *   - How much of the library is indexed (text vs visual — they diverge
 *     because text embeddings are cheap and land first, while CLIP image
 *     embeddings depend on a 90 MB download).
 *   - What's happening with the current query (embedding in flight vs
 *     already ranked) — separately for text and visual sides so the
 *     user sees when the visual half catches up mid-search.
 *   - Whether the ranker is actually running semantically or fell back
 *     to keyword (happens during model download or query-embed failure).
 */
function SemanticStatusBar({
  totalScenes,
  textIndexed,
  imageIndexed,
  queryTextEmbedding,
  queryImageEmbedding,
  activeMode,
  isQuerying,
  indexing,
}: {
  totalScenes: number;
  textIndexed: number;
  imageIndexed: number;
  queryTextEmbedding: 'idle' | 'embedding' | 'ready';
  queryImageEmbedding: 'idle' | 'embedding' | 'ready';
  activeMode: 'keyword' | 'semantic';
  isQuerying: boolean;
  indexing: boolean;
}) {
  const fullyIndexed = totalScenes > 0 && textIndexed === totalScenes && imageIndexed === totalScenes;
  const mutedWhenNotQuerying = isQuerying ? 'text-foreground/90' : 'text-muted-foreground';

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1 text-[10.5px]">
      <div className={cn('flex items-center gap-2', mutedWhenNotQuerying)}>
        <span className="flex items-center gap-1" title="Caption text embeddings (all-MiniLM)">
          <MessageSquareText className="h-2.5 w-2.5 text-sky-400" />
          Text {textIndexed}/{totalScenes}
        </span>
        <span className="flex items-center gap-1" title="CLIP image embeddings">
          <Eye className="h-2.5 w-2.5 text-purple-400" />
          Visual {imageIndexed}/{totalScenes}
        </span>
        {fullyIndexed && !indexing && (
          <span className="text-emerald-400/80" title="Library fully indexed">
            · ready
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {isQuerying && (
          <>
            <QueryStatusDot state={queryTextEmbedding} label="Text" tone="sky" />
            <QueryStatusDot state={queryImageEmbedding} label="Visual" tone="purple" />
            {activeMode === 'keyword' && (
              <span className="text-amber-400/80" title="Semantic embedding not ready — ranked by keyword">
                (keyword fallback)
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QueryStatusDot({
  state,
  label,
  tone,
}: {
  state: 'idle' | 'embedding' | 'ready';
  label: string;
  tone: 'sky' | 'purple';
}) {
  const toneClass = tone === 'sky' ? 'bg-sky-400' : 'bg-purple-400';
  if (state === 'embedding') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground" title={`${label} embedding in flight`}>
        <Loader2 className={cn('h-2.5 w-2.5 animate-spin', tone === 'sky' ? 'text-sky-400' : 'text-purple-400')} />
        {label}
      </span>
    );
  }
  if (state === 'ready') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground" title={`${label} match contributed`}>
        <span className={cn('h-1.5 w-1.5 rounded-full', toneClass)} />
        {label}
      </span>
    );
  }
  return null;
}

function SemanticIndexBanner({
  progress,
}: {
  progress: { indexing: number; indexTotal: number; loadingModel: boolean };
}) {
  const label = progress.loadingModel
    ? 'Downloading semantic model (~22 MB, first run only)…'
    : `Indexing captions for semantic search — ${progress.indexing}/${progress.indexTotal} clips`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-purple-400/20 bg-purple-400/5 px-3 py-2 text-[11px] text-purple-300/90">
      <BrainCircuit className="h-3 w-3 shrink-0 animate-pulse" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function ReanalyzingBanner({
  items,
}: {
  items: Array<{ id: string; fileName: string }>;
}) {
  const label = items.length === 1
    ? items[0]!.fileName
    : `${items.length} clips`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-primary/90">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      <span className="truncate">
        Re-analyzing <span className="font-medium">{label}</span> — scenes will refresh when done.
      </span>
    </div>
  );
}

function EmptyState({
  hasAnyCaptions,
  isFiltered,
}: {
  hasAnyCaptions: boolean;
  isFiltered: boolean;
}) {
  if (!hasAnyCaptions) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted-foreground">
        <Sparkles className="h-6 w-6 text-purple-400/60" />
        <p className="text-[12px]">No AI captions yet.</p>
        <p className="max-w-xs text-[11px] text-muted-foreground/80">
          Run <span className="font-medium">Analyze with AI</span> on a clip from the media
          library to generate searchable scene descriptions.
        </p>
      </div>
    );
  }
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-10 text-center text-muted-foreground">
        <p className="text-[12px]">No scenes match your search.</p>
        <p className="text-[11px] text-muted-foreground/80">
          Try a shorter query or switch scope to <span className="font-medium">All media</span>.
        </p>
      </div>
    );
  }
  return null;
}
