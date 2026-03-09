import { createLogger } from '@/shared/logging/logger';
import { VideoFrameExtractor } from './canvas-video-extractor';

const log = createLogger('SharedVideoExtractorPool');

export type VideoFrameFailureKind = 'none' | 'no-sample' | 'decode-error';

export interface VideoFrameSource {
  init(): Promise<boolean>;
  drawFrame(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<boolean>;
  getLastFailureKind(): VideoFrameFailureKind;
  getDimensions(): { width: number; height: number };
  getDuration(): number;
  dispose(): void;
}

interface SourceLane {
  extractor: VideoFrameExtractor;
  initialized: boolean;
  initPromise: Promise<boolean> | null;
  /** Serializes drawFrame calls to prevent concurrent mutable-state corruption. */
  drawLock: Promise<void> | null;
}

interface SourceState {
  src: string;
  lanes: SourceLane[];
  itemLaneById: Map<string, number>;
  laneAssignments: number[];
  sourceInitPromise: Promise<boolean> | null;
  sourceInitAttempted: boolean;
  sourceReady: boolean;
}

const DEFAULT_MAX_LANES_PER_SOURCE = 4;

class SharedItemVideoSource implements VideoFrameSource {
  constructor(
    private readonly pool: SharedVideoExtractorPool,
    private readonly itemId: string,
    private readonly src: string,
  ) {}

  init(): Promise<boolean> {
    return this.pool.initSource(this.src);
  }

  drawFrame(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<boolean> {
    return this.pool.drawItemFrame(this.itemId, this.src, ctx, timestamp, x, y, width, height);
  }

  getLastFailureKind(): VideoFrameFailureKind {
    return this.pool.getItemLastFailureKind(this.itemId, this.src);
  }

  getDimensions(): { width: number; height: number } {
    return this.pool.getItemDimensions(this.itemId, this.src);
  }

  getDuration(): number {
    return this.pool.getItemDuration(this.itemId, this.src);
  }

  // Shared lanes are owned/disposed by the pool.
  dispose(): void {}
}

export class SharedVideoExtractorPool {
  private readonly maxLanesPerSource: number;
  private sourceStates = new Map<string, SourceState>();
  private itemSources = new Map<string, string>();
  private itemWrappers = new Map<string, SharedItemVideoSource>();
  private laneIdCounter = 0;

  constructor(options?: { maxLanesPerSource?: number }) {
    this.maxLanesPerSource = Math.max(1, options?.maxLanesPerSource ?? DEFAULT_MAX_LANES_PER_SOURCE);
  }

  getOrCreateItemExtractor(itemId: string, src: string): VideoFrameSource {
    const existing = this.itemWrappers.get(itemId);
    const existingSrc = this.itemSources.get(itemId);
    if (existing && existingSrc === src) {
      return existing;
    }

    if (existingSrc && existingSrc !== src) {
      this.releaseItem(itemId);
    }

    this.itemSources.set(itemId, src);
    this.ensureSourceState(src);

    const wrapper = new SharedItemVideoSource(this, itemId, src);
    this.itemWrappers.set(itemId, wrapper);
    return wrapper;
  }

  async initSource(src: string): Promise<boolean> {
    const state = this.ensureSourceState(src);
    if (state.sourceReady) return true;
    if (state.sourceInitAttempted) return false;
    if (state.sourceInitPromise) return state.sourceInitPromise;

    state.sourceInitPromise = (async () => {
      const ready = await this.ensureLaneInitialized(state, 0);
      state.sourceInitAttempted = true;
      state.sourceReady = ready;
      return ready;
    })().finally(() => {
      state.sourceInitPromise = null;
    });

    return state.sourceInitPromise;
  }

  releaseItem(itemId: string): void {
    const src = this.itemSources.get(itemId);
    if (src) {
      this.unassignItem(itemId, src);
    }

    const wrapper = this.itemWrappers.get(itemId);
    wrapper?.dispose();

    this.itemSources.delete(itemId);
    this.itemWrappers.delete(itemId);
  }

  async drawItemFrame(
    itemId: string,
    src: string,
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    timestamp: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<boolean> {
    const state = this.ensureSourceState(src);
    const sourceReady = await this.initSource(src);
    if (!sourceReady) return false;

    let laneIndex = this.getAssignedLaneIndex(state, itemId);
    let laneReady = await this.ensureLaneInitialized(state, laneIndex);

    if (!laneReady && laneIndex !== 0) {
      laneIndex = 0;
      laneReady = await this.ensureLaneInitialized(state, laneIndex);
    }
    if (!laneReady) return false;

    // Serialize drawFrame calls per lane to prevent concurrent mutable-state corruption
    // inside VideoFrameExtractor (ensureSampleForTimestamp / recoverAndPrime).
    const lane = state.lanes[laneIndex]!;
    const prev = lane.drawLock ?? Promise.resolve();
    const result = prev.then(() =>
      lane.extractor.drawFrame(ctx, timestamp, x, y, width, height)
    );
    lane.drawLock = result.then(() => undefined, () => undefined);
    return result;
  }

  getItemLastFailureKind(itemId: string, src: string): VideoFrameFailureKind {
    const extractor = this.getExtractorForItem(itemId, src);
    return extractor?.getLastFailureKind() ?? 'none';
  }

  getItemDimensions(itemId: string, src: string): { width: number; height: number } {
    const extractor = this.getExtractorForItem(itemId, src);
    return extractor?.getDimensions() ?? { width: 1920, height: 1080 };
  }

  getItemDuration(itemId: string, src: string): number {
    const extractor = this.getExtractorForItem(itemId, src);
    return extractor?.getDuration() ?? 0;
  }

  dispose(): void {
    for (const state of this.sourceStates.values()) {
      for (const lane of state.lanes) {
        lane.extractor.dispose();
      }
      state.lanes = [];
      state.itemLaneById.clear();
      state.laneAssignments = [];
      state.sourceInitPromise = null;
      state.sourceReady = false;
    }
    this.sourceStates.clear();
    this.itemSources.clear();
    this.itemWrappers.clear();
  }

  private ensureSourceState(src: string): SourceState {
    let state = this.sourceStates.get(src);
    if (!state) {
      state = {
        src,
        lanes: [this.createLane(src)],
        itemLaneById: new Map<string, number>(),
        laneAssignments: [0],
        sourceInitPromise: null,
        sourceInitAttempted: false,
        sourceReady: false,
      };
      this.sourceStates.set(src, state);
    }
    return state;
  }

  private createLane(src: string): SourceLane {
    const extractorId = `shared-video-${++this.laneIdCounter}`;
    return {
      extractor: new VideoFrameExtractor(src, extractorId),
      initialized: false,
      initPromise: null,
      drawLock: null,
    };
  }

  private async ensureLaneInitialized(state: SourceState, laneIndex: number): Promise<boolean> {
    if (laneIndex < 0 || laneIndex >= state.lanes.length) return false;
    const lane = state.lanes[laneIndex]!;
    if (lane.initialized) return true;
    if (lane.initPromise) return lane.initPromise;

    lane.initPromise = lane.extractor.init()
      .then((ok) => {
        lane.initialized = ok;
        return ok;
      })
      .catch((error) => {
        log.warn('Shared lane initialization failed', { laneIndex, src: state.src, error });
        lane.initialized = false;
        return false;
      })
      .finally(() => {
        lane.initPromise = null;
      });

    return lane.initPromise;
  }

  private getAssignedLaneIndex(state: SourceState, itemId: string): number {
    const existing = state.itemLaneById.get(itemId);
    if (existing !== undefined) return existing;

    let bestLane = 0;
    let bestAssignments = Number.POSITIVE_INFINITY;
    for (let i = 0; i < state.laneAssignments.length; i += 1) {
      const assignments = state.laneAssignments[i] ?? 0;
      if (assignments < bestAssignments) {
        bestAssignments = assignments;
        bestLane = i;
      }
    }

    // Scale to a few lanes per source so simultaneous transition draws can
    // advance independent decode timelines without per-clip duplication.
    if (bestAssignments > 0 && state.lanes.length < this.maxLanesPerSource) {
      bestLane = state.lanes.length;
      state.lanes.push(this.createLane(state.src));
      state.laneAssignments.push(0);
    }

    state.itemLaneById.set(itemId, bestLane);
    state.laneAssignments[bestLane] = (state.laneAssignments[bestLane] ?? 0) + 1;
    return bestLane;
  }

  private getExtractorForItem(itemId: string, src: string): VideoFrameExtractor | null {
    const state = this.sourceStates.get(src);
    if (!state) return null;

    const laneIndex = state.itemLaneById.get(itemId) ?? 0;
    const lane = state.lanes[laneIndex] ?? state.lanes[0];
    return lane?.extractor ?? null;
  }

  private unassignItem(itemId: string, src: string): void {
    const state = this.sourceStates.get(src);
    if (!state) return;

    const laneIndex = state.itemLaneById.get(itemId);
    if (laneIndex !== undefined) {
      state.itemLaneById.delete(itemId);
      const prev = state.laneAssignments[laneIndex] ?? 0;
      state.laneAssignments[laneIndex] = Math.max(0, prev - 1);
    }
  }
}

