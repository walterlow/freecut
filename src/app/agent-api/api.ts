/**
 * `window.__FREECUT__` implementation. Exposes a stable, JSON-serializable
 * automation surface backed by the real timeline action modules. Agents
 * running in the page (or bridging in via CDP/MCP/extension) drive the
 * live editor through this API.
 *
 * All methods are async. Store modules are lazy-imported so disabling
 * the API at runtime costs nothing beyond the initial thunk.
 */

import type {
  AgentAddItem,
  AgentGpuEffect,
  AgentMarker,
  AgentPlaybackState,
  AgentSubscriber,
  AgentTimelineItem,
  AgentTimelineSnapshot,
  AgentTrack,
  AgentTransition,
  AgentTransform,
} from './types';

export interface FreecutAgentAPI {
  readonly version: string;
  ready(): Promise<void>;

  // Queries
  getPlayback(): Promise<AgentPlaybackState>;
  getTimeline(): Promise<AgentTimelineSnapshot>;
  getSelection(): Promise<{ itemIds: string[]; transitionId: string | null; markerId: string | null }>;
  getProjectMeta(): Promise<{ id: string | null; name: string | null; width: number; height: number; fps: number }>;

  // Playback
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(frame: number): Promise<void>;

  // Selection
  selectItems(ids: string[]): Promise<void>;

  // Mutations — tracks
  addTrack(opts?: { kind?: 'video' | 'audio'; name?: string }): Promise<AgentTrack>;
  removeTrack(id: string): Promise<void>;

  // Mutations — items
  addItem(item: AgentAddItem): Promise<AgentTimelineItem>;
  updateItem(id: string, updates: Record<string, unknown>): Promise<void>;
  moveItem(id: string, to: { from?: number; trackId?: string }): Promise<void>;
  removeItem(id: string): Promise<void>;
  setTransform(id: string, transform: AgentTransform): Promise<void>;

  // Mutations — effects
  addEffect(itemId: string, effect: AgentGpuEffect, enabled?: boolean): Promise<{ effectId: string }>;
  removeEffect(itemId: string, effectId: string): Promise<void>;

  // Mutations — transitions
  addTransition(opts: {
    leftClipId: string;
    rightClipId: string;
    durationInFrames?: number;
    presetId?: string;
  }): Promise<AgentTransition | null>;
  removeTransition(id: string): Promise<void>;

  // Mutations — markers
  addMarker(opts: { frame: number; label?: string; color?: string }): Promise<AgentMarker>;

  // Media library
  importMediaFromUrl(url: string): Promise<Array<{ id: string; fileName: string; width?: number; height?: number; duration?: number }>>;
  listMedia(): Promise<Array<{ id: string; fileName: string; mimeType: string; width?: number; height?: number; duration?: number; fps?: number }>>;

  // Project lifecycle
  listProjects(): Promise<Array<{ id: string; name: string; width: number; height: number; fps: number; updatedAt: number }>>;
  createProject(opts: { name: string; width?: number; height?: number; fps?: number; description?: string; backgroundColor?: string }): Promise<{ id: string; name: string }>;
  openProject(id: string): Promise<{ id: string; name: string }>;
  getWorkspaceStatus(): Promise<{ granted: boolean; name?: string }>;
  loadSnapshot(snapshotJson: string): Promise<{ projectId: string }>;
  exportSnapshot(): Promise<unknown>;

  // Events
  subscribe(callback: AgentSubscriber): () => void;
}

const API_VERSION = '0.1.0';

function randomId(kind: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${kind}-${hex}`;
}

// ---------------------------------------------------------------------------
// Lazy store loaders. Dynamic imports let this module sit in the initial
// bundle without pulling in the timeline/media-library trees.
// ---------------------------------------------------------------------------

async function loadStores() {
  const [
    playback,
    items,
    transitions,
    timeline,
    selection,
    projects,
    markers,
  ] = await Promise.all([
    import('@/shared/state/playback'),
    import('@/features/timeline/stores/items-store'),
    import('@/features/timeline/stores/transitions-store'),
    import('@/features/timeline/stores/timeline-store'),
    import('@/shared/state/selection'),
    import('@/features/projects/stores/project-store'),
    import('@/features/timeline/stores/markers-store'),
  ]);
  return {
    usePlaybackStore: playback.usePlaybackStore,
    useItemsStore: items.useItemsStore,
    useTransitionsStore: transitions.useTransitionsStore,
    useTimelineStore: timeline.useTimelineStore,
    useSelectionStore: selection.useSelectionStore,
    useProjectStore: projects.useProjectStore,
    useMarkersStore: markers.useMarkersStore,
  };
}

async function loadActions() {
  const [itemActions, transitionActions, effectActions, markerActions] = await Promise.all([
    import('@/features/timeline/stores/actions/item-actions'),
    import('@/features/timeline/stores/actions/transition-actions'),
    import('@/features/timeline/stores/actions/effect-actions'),
    import('@/features/timeline/stores/actions/marker-actions'),
  ]);
  return { itemActions, transitionActions, effectActions, markerActions };
}

// ---------------------------------------------------------------------------
// Mapping helpers — live TimelineItem/Track → agent DTOs.
// ---------------------------------------------------------------------------

function toAgentTrack(t: { id: string; name: string; kind?: 'video' | 'audio'; order: number; locked: boolean; visible: boolean; muted: boolean; solo: boolean }): AgentTrack {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind ?? 'video',
    order: t.order,
    locked: t.locked,
    visible: t.visible,
    muted: t.muted,
    solo: t.solo,
  };
}

function toAgentItem(item: Record<string, unknown>): AgentTimelineItem {
  const effects = Array.isArray(item.effects)
    ? (item.effects as Array<Record<string, unknown>>)
        .filter((e) => {
          const eff = e.effect as Record<string, unknown> | undefined;
          return eff?.type === 'gpu-effect';
        })
        .map((e) => ({
          id: String(e.id),
          enabled: Boolean(e.enabled),
          effect: e.effect as AgentGpuEffect,
        }))
    : undefined;
  const out: AgentTimelineItem = {
    id: String(item.id),
    type: item.type as AgentTimelineItem['type'],
    trackId: String(item.trackId),
    from: Number(item.from),
    durationInFrames: Number(item.durationInFrames),
    label: item.label as string | undefined,
    mediaId: item.mediaId as string | undefined,
  };
  if (effects && effects.length > 0) out.effects = effects;
  return out;
}

// ---------------------------------------------------------------------------
// Item construction — live TimelineItem from agent DTO.
// ---------------------------------------------------------------------------

function buildTimelineItem(input: AgentAddItem): Record<string, unknown> {
  if (input.durationInFrames <= 0) {
    throw new RangeError('durationInFrames must be positive');
  }
  if (input.from < 0) {
    throw new RangeError('from must be non-negative');
  }
  const base: Record<string, unknown> = {
    id: randomId('item'),
    trackId: input.trackId,
    from: input.from,
    durationInFrames: input.durationInFrames,
    label: input.label ?? input.type,
  };
  if (input.mediaId) base.mediaId = input.mediaId;
  if (input.transform) base.transform = input.transform;

  switch (input.type) {
    case 'video':
      return { ...base, type: 'video', ...(input.src && { src: input.src }), ...pick(input, ['sourceWidth', 'sourceHeight', 'volume']) };
    case 'audio':
      return { ...base, type: 'audio', ...(input.src && { src: input.src }), ...pick(input, ['volume']) };
    case 'image':
      return { ...base, type: 'image', ...(input.src && { src: input.src }), ...pick(input, ['sourceWidth', 'sourceHeight']) };
    case 'text':
      if (!input.text) throw new Error('text items require a non-empty `text` field');
      return {
        ...base,
        type: 'text',
        text: input.text,
        color: input.color ?? '#ffffff',
        ...pick(input, ['fontSize', 'fontFamily']),
      };
    case 'shape':
      if (!input.shapeType) throw new Error('shape items require a `shapeType`');
      return {
        ...base,
        type: 'shape',
        shapeType: input.shapeType,
        fillColor: input.fillColor ?? '#ffffff',
        ...pick(input, ['strokeColor', 'strokeWidth']),
      };
    case 'adjustment':
      return { ...base, type: 'adjustment' };
  }
}

function pick<T extends object>(obj: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

type UnsubscribeFn = () => void;

/**
 * Switch the address bar to /editor/:id. Prefers the TanStack Router
 * instance if it's been exposed on window (set up below during bootstrap);
 * falls back to pushState + popstate which the router listens to; last
 * resort is location.assign (full reload).
 */
async function navigateToEditor(projectId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const target = `/editor/${projectId}`;

  const router = (window as unknown as { __FREECUT_ROUTER__?: { navigate: (opts: unknown) => Promise<void> } }).__FREECUT_ROUTER__;
  if (router) {
    await router.navigate({ to: '/editor/$projectId', params: { projectId } });
    return;
  }

  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/**
 * Wait until the editor route has mounted and finished its initial
 * loadTimeline() pass for `projectId`. Prevents agent mutations from
 * being clobbered by the editor's async load-on-mount.
 */
async function waitForEditorReady(projectId: string, { timeoutMs = 8000 } = {}): Promise<void> {
  const [
    { useTimelineSettingsStore },
    { useProjectStore },
  ] = await Promise.all([
    import('@/features/timeline/stores/timeline-settings-store'),
    import('@/features/projects/stores/project-store'),
  ]);

  const deadline = Date.now() + timeoutMs;

  // Phase 1: wait for the editor component to mark itself loading. If
  // it never does (e.g. we're on /projects and navigation didn't land),
  // the current-project check also has to pass.
  while (Date.now() < deadline) {
    const current = useProjectStore.getState().currentProject;
    const loading = useTimelineSettingsStore.getState().isTimelineLoading;
    if (current?.id === projectId && !loading) {
      // Give the mount-time loadTimeline one more tick to kick off — then
      // re-check. Prevents returning between navigation and load start.
      await new Promise((r) => setTimeout(r, 50));
      const stillLoading = useTimelineSettingsStore.getState().isTimelineLoading;
      if (!stillLoading) return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function installSubscription(callback: AgentSubscriber): Promise<UnsubscribeFn> {
  return loadStores().then((s) => {
    const unsubs: Array<() => void> = [];
    const fire = () => callback({ type: 'change' });
    unsubs.push(s.useItemsStore.subscribe(fire));
    unsubs.push(s.useTransitionsStore.subscribe(fire));
    unsubs.push(s.useTimelineStore.subscribe(fire));
    return () => {
      for (const u of unsubs) u();
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createAgentAPI(): FreecutAgentAPI {
  return {
    version: API_VERSION,

    async ready() {
      await loadStores();
    },

    async getPlayback() {
      const { usePlaybackStore } = await loadStores();
      const s = usePlaybackStore.getState();
      const rawZoom = Number(s.zoom ?? -1);
      // The playback store uses -1 as a sentinel for auto-fit. Expose
      // that as a string so agents don't accidentally arithmetic on it.
      const previewZoom: 'auto' | number = rawZoom < 0 ? 'auto' : rawZoom;
      return {
        currentFrame: s.currentFrame,
        isPlaying: Boolean(s.isPlaying),
        previewZoom,
      };
    },

    async getTimeline() {
      const { useTimelineStore, useItemsStore, useTransitionsStore, useMarkersStore } = await loadStores();
      const tracks = useTimelineStore.getState().tracks ?? [];
      const items = useItemsStore.getState().items ?? [];
      const transitions = useTransitionsStore.getState().transitions ?? [];
      const markers = useMarkersStore.getState().markers ?? [];
      return {
        tracks: tracks.map(toAgentTrack),
        items: items.map((it) => toAgentItem(it as unknown as Record<string, unknown>)),
        transitions: transitions.map((t) => {
          const rec = t as unknown as Record<string, unknown>;
          return {
            id: String(rec.id),
            type: String(rec.type),
            leftClipId: String(rec.leftClipId),
            rightClipId: String(rec.rightClipId),
            trackId: String(rec.trackId),
            durationInFrames: Number(rec.durationInFrames),
            presetId: rec.presetId as string | undefined,
          };
        }),
        markers: markers.map((m) => ({
          id: String(m.id),
          frame: Number(m.frame),
          label: m.label,
          color: String(m.color),
        })),
      };
    },

    async getSelection() {
      const { useSelectionStore } = await loadStores();
      const s = useSelectionStore.getState();
      return {
        itemIds: [...s.selectedItemIds],
        transitionId: s.selectedTransitionId ?? null,
        markerId: s.selectedMarkerId ?? null,
      };
    },

    async getProjectMeta() {
      const { useProjectStore } = await loadStores();
      const p = useProjectStore.getState().currentProject;
      if (!p) return { id: null, name: null, width: 1920, height: 1080, fps: 30 };
      return {
        id: p.id,
        name: p.name,
        width: p.metadata.width,
        height: p.metadata.height,
        fps: p.metadata.fps,
      };
    },

    async play() {
      const { usePlaybackStore } = await loadStores();
      usePlaybackStore.getState().play();
    },

    async pause() {
      const { usePlaybackStore } = await loadStores();
      usePlaybackStore.getState().pause();
    },

    async seek(frame: number) {
      if (!Number.isFinite(frame) || frame < 0) {
        throw new RangeError(`seek frame must be non-negative, got ${frame}`);
      }
      const { usePlaybackStore } = await loadStores();
      usePlaybackStore.getState().setCurrentFrame(Math.round(frame));
    },

    async selectItems(ids: string[]) {
      const { useSelectionStore } = await loadStores();
      useSelectionStore.getState().selectItems(ids);
    },

    async addTrack(opts = {}) {
      const kind = opts.kind ?? 'video';
      const { useTimelineStore, useProjectStore } = await loadStores();
      if (!useProjectStore.getState().currentProject) {
        throw new Error(
          'no project is currently loaded — open a project in the editor before mutating the timeline',
        );
      }
      const { getNextClassicTrackName } = await import(
        '@/features/timeline/utils/classic-tracks'
      );
      const current = useTimelineStore.getState().tracks ?? [];
      const minOrder = current.length > 0 ? Math.min(...current.map((t) => t.order ?? 0)) : 0;
      const name = opts.name ?? getNextClassicTrackName(current as never, kind);
      const track = {
        id: randomId('track'),
        name,
        kind,
        height: 60,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        order: minOrder - 1,
        items: [],
      };
      useTimelineStore.getState().setTracks([track, ...current] as never);
      return toAgentTrack(track);
    },

    async removeTrack(id: string) {
      const { useTimelineStore } = await loadStores();
      const current = useTimelineStore.getState().tracks ?? [];
      useTimelineStore.getState().setTracks(current.filter((t) => t.id !== id));
    },

    async addItem(input: AgentAddItem): Promise<AgentTimelineItem> {
      const { useProjectStore, useTimelineStore } = await loadStores();
      if (!useProjectStore.getState().currentProject) {
        throw new Error(
          'no project is currently loaded — open a project in the editor before mutating the timeline',
        );
      }
      const built = buildTimelineItem(input) as Record<string, unknown>;

      // Auto-populate source-media fields and resolve companion audio
      // when a mediaId is given. Without source* the player doesn't know
      // where in the source file to pull frames; without the audio
      // companion, video clips with sound appear silent.
      let media: Record<string, unknown> | undefined;
      if ((input.type === 'video' || input.type === 'audio' || input.type === 'image') && input.mediaId) {
        const { useMediaLibraryStore } = await import('@/features/media-library/stores/media-library-store');
        media = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === input.mediaId) as Record<string, unknown> | undefined;
        if (media) {
          if (input.type !== 'image') {
            const sourceFps = media.fps as number | undefined;
            if (sourceFps && built.sourceFps === undefined) built.sourceFps = sourceFps;
            const sourceDuration = media.duration as number | undefined;
            if (sourceFps && sourceDuration && built.sourceDuration === undefined) {
              built.sourceDuration = Math.round(sourceDuration * sourceFps);
            }
            if (built.sourceStart === undefined) built.sourceStart = 0;
            if (built.sourceEnd === undefined && sourceFps && sourceDuration) {
              const projFps = useProjectStore.getState().currentProject?.metadata.fps ?? sourceFps;
              const clipFrames = Number(built.durationInFrames ?? 0);
              built.sourceEnd = Math.round((clipFrames / projFps) * sourceFps);
            }
          }
          if ((input.type === 'video' || input.type === 'image') && built.sourceWidth === undefined) {
            built.sourceWidth = media.width as number | undefined;
          }
          if ((input.type === 'video' || input.type === 'image') && built.sourceHeight === undefined) {
            built.sourceHeight = media.height as number | undefined;
          }
        }
      }

      const { itemActions } = await loadActions();

      // If the input is a video whose source media has supported audio,
      // split into linked V+A clips the way drag-drop does. Opt out with
      // `skipAudio: true` in the input.
      const isVideoWithAudio =
        input.type === 'video' &&
        media !== undefined &&
        Boolean(media.audioCodec) &&
        media.audioCodecSupported !== false &&
        (input as { skipAudio?: boolean }).skipAudio !== true;

      if (!isVideoWithAudio) {
        itemActions.addItem(built as never);
        return toAgentItem(built);
      }

      const linkedGroupId = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? randomId('grp');
      built.linkedGroupId = linkedGroupId;

      // Find or create an audio track for the companion.
      const { getNextClassicTrackName } = await import('@/features/timeline/utils/classic-tracks');
      const tracks = useTimelineStore.getState().tracks ?? [];
      let audioTrack = tracks.find((t) => t.kind === 'audio' && !t.isGroup);
      if (!audioTrack) {
        // Place below the lowest track (highest `order` value).
        const maxOrder = tracks.length > 0 ? Math.max(...tracks.map((t) => t.order ?? 0)) : 0;
        const newTrack = {
          id: randomId('track'),
          name: getNextClassicTrackName(tracks as never, 'audio'),
          kind: 'audio' as const,
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          volume: 0,
          order: maxOrder + 1,
          items: [],
        };
        useTimelineStore.getState().setTracks([...tracks, newTrack] as never);
        audioTrack = newTrack as unknown as typeof audioTrack;
      }

      const audioCompanion: Record<string, unknown> = {
        id: randomId('item'),
        trackId: (audioTrack as { id: string }).id,
        from: built.from,
        durationInFrames: built.durationInFrames,
        label: built.label,
        mediaId: input.mediaId,
        linkedGroupId,
        type: 'audio',
        sourceFps: built.sourceFps,
        sourceDuration: built.sourceDuration,
        sourceStart: built.sourceStart,
        sourceEnd: built.sourceEnd,
        ...((input as { volume?: number }).volume !== undefined && { volume: (input as { volume?: number }).volume }),
      };

      itemActions.addItems([built, audioCompanion] as never);
      return toAgentItem(built);
    },

    async updateItem(id: string, updates: Record<string, unknown>) {
      const { itemActions } = await loadActions();
      itemActions.updateItem(id, updates as never);
    },

    async moveItem(id: string, to: { from?: number; trackId?: string }) {
      const { itemActions } = await loadActions();
      const { useItemsStore } = await loadStores();
      const item = useItemsStore.getState().items.find((it: { id: string }) => it.id === id);
      if (!item) throw new Error(`no item with id ${id}`);
      const newFrom = to.from ?? (item as { from: number }).from;
      itemActions.moveItem(id, newFrom, to.trackId);
    },

    async removeItem(id: string) {
      const { itemActions } = await loadActions();
      itemActions.removeItems([id]);
    },

    async setTransform(id: string, transform: AgentTransform) {
      const { itemActions } = await loadActions();
      itemActions.updateItem(id, { transform } as never);
    },

    async addEffect(itemId: string, effect: AgentGpuEffect, enabled = true) {
      if (effect.type !== 'gpu-effect') throw new Error('only gpu-effect is supported');
      const { effectActions } = await loadActions();
      const effectId = randomId('effect');
      effectActions.addEffect(itemId, {
        id: effectId,
        enabled,
        effect,
      } as never);
      return { effectId };
    },

    async removeEffect(itemId: string, effectId: string) {
      const { effectActions } = await loadActions();
      effectActions.removeEffect(itemId, effectId);
    },

    async addTransition(opts) {
      const { transitionActions } = await loadActions();
      const { useTransitionsStore } = await loadStores();
      const before = new Set(useTransitionsStore.getState().transitions.map((t: { id: string }) => t.id));
      const ok = transitionActions.addTransition(
        opts.leftClipId,
        opts.rightClipId,
        'crossfade',
        opts.durationInFrames,
        opts.presetId as never,
      );
      if (!ok) return null;
      const after = useTransitionsStore.getState().transitions;
      const created = after.find((t: { id: string }) => !before.has(t.id));
      if (!created) return null;
      return {
        id: String(created.id),
        type: String(created.type),
        leftClipId: String(created.leftClipId),
        rightClipId: String(created.rightClipId),
        trackId: String(created.trackId),
        durationInFrames: Number(created.durationInFrames),
        presetId: (created as { presetId?: string }).presetId,
      };
    },

    async removeTransition(id: string) {
      const { transitionActions } = await loadActions();
      transitionActions.removeTransition(id);
    },

    async addMarker(opts) {
      const { markerActions } = await loadActions();
      const color = opts.color ?? '#ff4444';
      const before = (await loadStores()).useMarkersStore.getState().markers.map((m: { id: string }) => m.id);
      const beforeSet = new Set(before);
      // marker-actions exports `addMarker` — use it if present, otherwise fall back to direct store write.
      if (typeof (markerActions as { addMarker?: unknown }).addMarker === 'function') {
        (markerActions as { addMarker: (frame: number, label?: string, color?: string) => void })
          .addMarker(opts.frame, opts.label, color);
      } else {
        const { useMarkersStore } = await loadStores();
        const m = { id: randomId('marker'), frame: opts.frame, color, ...(opts.label && { label: opts.label }) };
        (useMarkersStore.getState() as { setMarkers?: (m: unknown[]) => void }).setMarkers?.([
          ...useMarkersStore.getState().markers,
          m,
        ]);
      }
      const after = (await loadStores()).useMarkersStore.getState().markers;
      const created = after.find((m: { id: string }) => !beforeSet.has(m.id));
      return {
        id: String(created?.id ?? ''),
        frame: Number(created?.frame ?? opts.frame),
        label: (created as { label?: string } | undefined)?.label,
        color: String((created as { color?: string } | undefined)?.color ?? color),
      };
    },

    async importMediaFromUrl(url: string) {
      if (!url || typeof url !== 'string') throw new Error('importMediaFromUrl: url is required');
      const { useProjectStore } = await loadStores();
      if (!useProjectStore.getState().currentProject) {
        throw new Error('no project is currently loaded — open or create a project before importing media');
      }
      const { useMediaLibraryStore } = await import('@/features/media-library/stores/media-library-store');
      const imported = await useMediaLibraryStore.getState().importMediaFromUrl(url);
      return imported.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        width: m.width,
        height: m.height,
        duration: m.duration,
      }));
    },

    async listMedia() {
      const { useMediaLibraryStore } = await import('@/features/media-library/stores/media-library-store');
      const items = useMediaLibraryStore.getState().mediaItems ?? [];
      return items.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        mimeType: m.mimeType,
        width: m.width,
        height: m.height,
        duration: m.duration,
        fps: m.fps,
      }));
    },

    async listProjects() {
      const { useProjectStore } = await loadStores();
      let projects = useProjectStore.getState().projects;
      if (!projects || projects.length === 0) {
        // First call in a session — stores lazy-load project list on demand.
        await useProjectStore.getState().loadProjects();
        projects = useProjectStore.getState().projects ?? [];
      }
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        width: p.metadata.width,
        height: p.metadata.height,
        fps: p.metadata.fps,
        updatedAt: p.updatedAt,
      }));
    },

    async createProject(opts) {
      if (!opts?.name || !opts.name.trim()) throw new Error('createProject: name is required');
      const { useProjectStore } = await loadStores();
      const data = {
        name: opts.name.trim(),
        description: opts.description ?? '',
        width: opts.width ?? 1920,
        height: opts.height ?? 1080,
        fps: opts.fps ?? 30,
        ...(opts.backgroundColor !== undefined && { backgroundColor: opts.backgroundColor }),
      };
      const project = await useProjectStore.getState().createProject(data);
      await useProjectStore.getState().loadProject(project.id);
      try {
        await navigateToEditor(project.id);
      } catch {
        // non-fatal
      }
      await waitForEditorReady(project.id);
      return { id: project.id, name: project.name };
    },

    async openProject(id: string) {
      if (!id) throw new Error('openProject: id is required');
      const { useProjectStore } = await loadStores();
      const project = await useProjectStore.getState().loadProject(id);
      if (!project) throw new Error(`no project with id ${id}`);
      try {
        await navigateToEditor(id);
      } catch {
        // non-fatal
      }
      await waitForEditorReady(id);
      return { id: project.id, name: project.name };
    },

    async getWorkspaceStatus() {
      try {
        const { getWorkspaceRoot } = await import('@/infrastructure/storage/workspace-fs/root');
        const root = getWorkspaceRoot();
        if (root) {
          const name = (root as { name?: string }).name;
          return name ? { granted: true, name } : { granted: true };
        }
      } catch {
        // fall through
      }
      return { granted: false };
    },

    async loadSnapshot(snapshotJson: string) {
      const { importProjectFromJsonString } = await import(
        '@/features/project-bundle/services/json-import-service'
      );
      const result = await importProjectFromJsonString(snapshotJson);
      const { useProjectStore } = await loadStores();
      await useProjectStore.getState().loadProject(result.project.id);
      return { projectId: result.project.id };
    },

    async exportSnapshot() {
      const [{ createSnapshotFromProject }, { useProjectStore }] = await Promise.all([
        import('@/features/project-bundle/services/json-export-service'),
        import('@/features/projects/stores/project-store'),
      ]);
      const project = useProjectStore.getState().currentProject;
      if (!project) throw new Error('no project is currently loaded');
      return createSnapshotFromProject(project);
    },

    subscribe(callback: AgentSubscriber): () => void {
      // Return an unsubscribe that works even before the async install resolves.
      let cancelled = false;
      let real: UnsubscribeFn | null = null;
      installSubscription(callback)
        .then((u) => {
          if (cancelled) {
            u();
          } else {
            real = u;
          }
        })
        .catch(() => {
          // Stores failed to load — either the environment was torn down
          // (tests) or the app is still booting. Swallow silently: the
          // caller's unsubscribe handle remains valid and a no-op.
        });
      return () => {
        cancelled = true;
        real?.();
      };
    },
  };
}
