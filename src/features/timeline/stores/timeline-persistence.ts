import type { LoadTimelineOptions } from '../types';
import type { ItemKeyframes } from '@/types/keyframe';
import type { AudioItem, CompositionItem, TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ProjectTimeline, Project } from '@/types/project';

import { createLogger, createOperationId } from '@/shared/logging/logger';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { usePlaybackStore } from '@/shared/state/playback';
import { DEFAULT_TRACK_HEIGHT } from '../constants';
import {
  createClassicTrack,
  createDefaultClassicTracks,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
} from '../utils/classic-tracks';
import { timelineToSourceFrames } from '../utils/source-calculations';
import { useZoomStore } from './zoom-store';
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTimelineCommandStore } from './timeline-command-store';
import { useCompositionsStore } from './compositions-store';
import { useCompositionNavigationStore } from './composition-navigation-store';
import { getProject, updateProject, saveThumbnail } from '@/infrastructure/storage';
import {
  renderSingleFrame,
  convertTimelineToComposition,
} from '@/features/timeline/deps/export-contract';
import { resolveMediaUrls } from '@/features/timeline/deps/media-library-resolver';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { validateProjectMediaReferences } from '@/features/timeline/utils/media-validation';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import { useSettingsStore } from '@/features/timeline/deps/settings-contract';
import { migrateProject, CURRENT_SCHEMA_VERSION } from '@/core/projects/migrations';
import {
  needsLegacyAvTrackLayoutRepair,
  repairLegacyAvTrackLayout,
} from '@/features/timeline/utils/legacy-av-track-repair';
import { getCompositionOwnedAudioSources } from '@/features/timeline/utils/composition-clip-summary';
import {
  getLinkedCompositionAudioCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media';
import {
  getEffectiveTimelineMaxFrame,
  sanitizeInOutPoints,
} from '../utils/in-out-points';

const logger = createLogger('TimelineStore');

/**
 * Progressive downscale a canvas to a JPEG blob.
 * Halves dimensions repeatedly to avoid aliasing with high-frequency effects.
 */
async function scaleCanvasToBlob(
  source: OffscreenCanvas | HTMLCanvasElement,
  targetW: number,
  targetH: number,
  quality: number,
): Promise<Blob> {
  let srcW = source.width;
  let srcH = source.height;
  let current: OffscreenCanvas | HTMLCanvasElement = source;

  while (srcW > targetW * 2 || srcH > targetH * 2) {
    const nextW = Math.max(Math.ceil(srcW / 2), targetW);
    const nextH = Math.max(Math.ceil(srcH / 2), targetH);
    const step = new OffscreenCanvas(nextW, nextH);
    const ctx = step.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, nextW, nextH);
    current = step;
    srcW = nextW;
    srcH = nextH;
  }

  const out = new OffscreenCanvas(targetW, targetH);
  const outCtx = out.getContext('2d')!;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(current, 0, 0, targetW, targetH);
  return out.convertToBlob({ type: 'image/jpeg', quality });
}

function collectVideoMediaIds(project: Project): string[] {
  const mediaIds = new Set<string>();
  const timeline = project.timeline;
  if (!timeline) return [];

  for (const item of timeline.items ?? []) {
    if (item.type === 'video' && item.mediaId) {
      mediaIds.add(item.mediaId);
    }
  }

  for (const composition of timeline.compositions ?? []) {
    for (const item of composition.items ?? []) {
      if (item.type === 'video' && item.mediaId) {
        mediaIds.add(item.mediaId);
      }
    }
  }

  return [...mediaIds];
}

function cloneTransitionForProject(transition: Transition): Transition {
  return {
    ...transition,
    ...(transition.bezierPoints && { bezierPoints: { ...transition.bezierPoints } }),
    ...(transition.properties && { properties: { ...transition.properties } }),
  };
}

function stripTimelineItemThumbnailUrl<T extends { thumbnailUrl?: string }>(item: T): T {
  if (item.thumbnailUrl === undefined) {
    return item;
  }

  const rest = { ...item };
  delete rest.thumbnailUrl;
  return rest as T;
}

function sanitizeTimelineEphemeralFields(timeline: ProjectTimeline): {
  timeline: ProjectTimeline;
  cleaned: boolean;
} {
  let cleaned = false;

  const items = (timeline.items ?? []).map((item) => {
    if (item.thumbnailUrl === undefined) {
      return item;
    }

    cleaned = true;
    return stripTimelineItemThumbnailUrl(item);
  }) as ProjectTimeline['items'];

  const compositions = timeline.compositions?.map((composition) => {
    let compositionCleaned = false;

    const nextItems = (composition.items ?? []).map((item) => {
      if (item.thumbnailUrl === undefined) {
        return item;
      }

      cleaned = true;
      compositionCleaned = true;
      return stripTimelineItemThumbnailUrl(item);
    }) as ProjectTimeline['items'];

    if (!compositionCleaned) {
      return composition;
    }

    return {
      ...composition,
      items: nextItems,
    };
  }) as ProjectTimeline['compositions'];

  if (!cleaned) {
    return { timeline, cleaned: false };
  }

  return {
    timeline: {
      ...timeline,
      items,
      ...(compositions && { compositions }),
    },
    cleaned: true,
  };
}

async function buildVideoHasAudioMap(mediaIds: string[]): Promise<Record<string, boolean | undefined>> {
  const mediaById = useMediaLibraryStore.getState().mediaById;
  const entries = await Promise.all(mediaIds.map(async (mediaId) => {
    const cachedMedia = mediaById[mediaId];
    if (cachedMedia) {
      return [mediaId, !!cachedMedia.audioCodec] as const;
    }

    const media = await mediaLibraryService.getMedia(mediaId);
    return [mediaId, !!media?.audioCodec] as const;
  }));

  return Object.fromEntries(entries);
}

function normalizeCompoundWrapperSourceFields(params: {
  item: CompositionItem | (AudioItem & { compositionId: string });
  compositionFps: number;
  timelineFps: number;
  fallbackDurationInFrames: number;
}) {
  const { item, compositionFps, timelineFps, fallbackDurationInFrames } = params;
  const sourceFps = item.sourceFps ?? compositionFps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? 0;
  const inferredSourceDuration = timelineToSourceFrames(
    item.durationInFrames || fallbackDurationInFrames,
    speed,
    timelineFps,
    sourceFps,
  );

  return {
    sourceStart,
    sourceEnd: item.sourceEnd ?? (sourceStart + inferredSourceDuration),
    sourceDuration: item.sourceDuration ?? inferredSourceDuration,
    sourceFps,
    speed,
  };
}

function hasCompositionVisualItems(items: TimelineItem[]): boolean {
  return items.some((item) => item.type !== 'audio');
}

function cleanupRedundantEmptyClassicAudioTracks(project: Project): { project: Project; cleaned: boolean } {
  if (!project.timeline?.tracks?.length) {
    return { project, cleaned: false };
  }

  const itemsByTrackId = new Map<string, number>();
  for (const item of project.timeline.items ?? []) {
    itemsByTrackId.set(item.trackId, (itemsByTrackId.get(item.trackId) ?? 0) + 1);
  }

  const classicAudioTracks = (project.timeline.tracks as TimelineTrack[])
    .map((track) => {
      const match = track.name.match(/^A(\d+)$/i);
      return match
        ? { track, number: Number.parseInt(match[1]!, 10) }
        : null;
    })
    .filter((entry): entry is { track: TimelineTrack; number: number } => !!entry)
    .filter(({ track, number }) => getTrackKind(track) === 'audio' && Number.isFinite(number));

  const highestOccupiedClassicAudioNumber = classicAudioTracks.reduce((highest, { track, number }) => {
    return (itemsByTrackId.get(track.id) ?? 0) > 0
      ? Math.max(highest, number)
      : highest;
  }, 0);

  if (highestOccupiedClassicAudioNumber <= 0) {
    return { project, cleaned: false };
  }

  const removableTrackIds = new Set(
    classicAudioTracks
      .filter(({ track, number }) => number > highestOccupiedClassicAudioNumber && (itemsByTrackId.get(track.id) ?? 0) === 0)
      .map(({ track }) => track.id),
  );

  if (removableTrackIds.size === 0) {
    return { project, cleaned: false };
  }

  return {
    cleaned: true,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.filter((track) => !removableTrackIds.has(track.id)),
      },
    },
  };
}

function repairCompoundClipWrappers(project: Project): { project: Project; repaired: boolean } {
  if (!project.timeline?.tracks || !project.timeline.items || !project.timeline.compositions?.length) {
    return { project, repaired: false };
  }

  let tracks = project.timeline.tracks.map((track) => ({ ...track })) as TimelineTrack[];
  const items = project.timeline.items.map((item) => ({ ...item })) as TimelineItem[];
  const compositionsById = new Map((project.timeline.compositions ?? []).map((composition) => [composition.id, composition]));
  const timelineFps = project.metadata?.fps ?? 30;
  let changed = false;

  const ensureTrackOfKindNear = (
    baseTrackId: string,
    kind: 'video' | 'audio',
    direction: 'above' | 'below',
  ): string => {
    const baseTrack = tracks.find((track) => track.id === baseTrackId) ?? null;
    if (!baseTrack) return baseTrackId;

    const nearestTrack = findNearestTrackByKind({
      tracks,
      targetTrack: baseTrack,
      kind,
      direction,
    });
    if (nearestTrack) return nearestTrack.id;

    const createdTrack = createClassicTrack({
      tracks,
      kind,
      order: getAdjacentTrackOrder(tracks, baseTrack, direction),
      height: baseTrack.height ?? DEFAULT_TRACK_HEIGHT,
    });
    tracks = [...tracks, createdTrack];
    changed = true;
    return createdTrack.id;
  };

  const compositionWrappers = items.filter((item): item is CompositionItem => item.type === 'composition');
  for (const wrapper of compositionWrappers) {
    const composition = compositionsById.get(wrapper.compositionId);
    if (!composition) continue;

    const wrapperIndex = items.findIndex((item) => item.id === wrapper.id);
    if (wrapperIndex === -1) continue;

    const hasVisualWrapper = hasCompositionVisualItems(composition.items as TimelineItem[]);
    const hasOwnedAudio = getCompositionOwnedAudioSources({
      items: composition.items as TimelineItem[],
      tracks: composition.tracks as TimelineTrack[],
      fps: composition.fps,
    }).length > 0;
    const wrapperTrack = tracks.find((track) => track.id === wrapper.trackId) ?? null;
    const wrapperTrackKind = wrapperTrack ? getTrackKind(wrapperTrack) : null;
    const existingAudioCompanion = getLinkedCompositionAudioCompanion(items, wrapper)
      ?? items.find((item): item is AudioItem & { compositionId: string } => (
        item.id !== wrapper.id
        && isCompositionAudioItem(item)
        && item.compositionId === wrapper.compositionId
      ))
      ?? null;
    const sourceFields = normalizeCompoundWrapperSourceFields({
      item: wrapper,
      compositionFps: composition.fps,
      timelineFps,
      fallbackDurationInFrames: composition.durationInFrames,
    });

    if (!hasVisualWrapper && hasOwnedAudio) {
      const audioTrackId = wrapperTrackKind === 'audio'
        ? wrapper.trackId
        : existingAudioCompanion?.trackId
        ? existingAudioCompanion.trackId
        : ensureTrackOfKindNear(wrapper.trackId, 'audio', 'below');
      items[wrapperIndex] = {
        ...wrapper,
        type: 'audio',
        trackId: audioTrackId,
        src: '',
        ...sourceFields,
      } as AudioItem;
      // Remove the existing audio companion to avoid a duplicate overlapping audio item
      if (existingAudioCompanion) {
        const companionIndex = items.findIndex((i) => i.id === existingAudioCompanion.id);
        if (companionIndex !== -1) {
          items.splice(companionIndex, 1);
        }
      }
      changed = true;
      continue;
    }

    const visualTrackId = hasVisualWrapper && wrapperTrackKind === 'audio'
      ? ensureTrackOfKindNear(wrapper.trackId, 'video', 'above')
      : wrapper.trackId;
    const audioTrackId = hasOwnedAudio
      ? (existingAudioCompanion?.trackId
          ?? (wrapperTrackKind === 'audio'
          ? wrapper.trackId
          : ensureTrackOfKindNear(visualTrackId, 'audio', 'below')))
      : null;
    const linkedGroupId = hasOwnedAudio
      ? existingAudioCompanion?.linkedGroupId ?? wrapper.linkedGroupId ?? crypto.randomUUID()
      : wrapper.linkedGroupId;

    const nextWrapper: CompositionItem = {
      ...wrapper,
      trackId: visualTrackId,
      linkedGroupId,
      ...sourceFields,
    };
    items[wrapperIndex] = nextWrapper;
    if (
      nextWrapper.trackId !== wrapper.trackId
      || nextWrapper.linkedGroupId !== wrapper.linkedGroupId
      || nextWrapper.sourceStart !== wrapper.sourceStart
      || nextWrapper.sourceEnd !== wrapper.sourceEnd
      || nextWrapper.sourceDuration !== wrapper.sourceDuration
      || nextWrapper.sourceFps !== wrapper.sourceFps
      || nextWrapper.speed !== wrapper.speed
    ) {
      changed = true;
    }

    const companionIndex = items.findIndex((item) => (
      item.id !== nextWrapper.id
      && isCompositionAudioItem(item)
      && item.compositionId === nextWrapper.compositionId
      && (!linkedGroupId || item.linkedGroupId === linkedGroupId || item.linkedGroupId === existingAudioCompanion?.linkedGroupId)
    ));

    if (!hasOwnedAudio) {
      if (companionIndex !== -1) {
        items.splice(companionIndex, 1);
        changed = true;
      }
      continue;
    }

    if (!audioTrackId) continue;

    if (companionIndex === -1) {
      items.push({
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audioTrackId,
        from: nextWrapper.from,
        durationInFrames: nextWrapper.durationInFrames,
        label: nextWrapper.label,
        linkedGroupId,
        compositionId: nextWrapper.compositionId,
        src: '',
        ...sourceFields,
      } satisfies AudioItem);
      changed = true;
      continue;
    }

    const existingCompanion = items[companionIndex] as AudioItem & { compositionId: string };
    const companionSourceFields = normalizeCompoundWrapperSourceFields({
      item: existingCompanion,
      compositionFps: composition.fps,
      timelineFps,
      fallbackDurationInFrames: composition.durationInFrames,
    });
    const normalizedCompanion: AudioItem & { compositionId: string } = {
      ...existingCompanion,
      trackId: audioTrackId,
      from: nextWrapper.from,
      durationInFrames: nextWrapper.durationInFrames,
      label: nextWrapper.label,
      linkedGroupId,
      compositionId: nextWrapper.compositionId,
      src: existingCompanion.src || '',
      ...companionSourceFields,
    };
    items[companionIndex] = normalizedCompanion;
    if (
      normalizedCompanion.trackId !== existingCompanion.trackId
      || normalizedCompanion.from !== existingCompanion.from
      || normalizedCompanion.durationInFrames !== existingCompanion.durationInFrames
      || normalizedCompanion.label !== existingCompanion.label
      || normalizedCompanion.linkedGroupId !== existingCompanion.linkedGroupId
      || normalizedCompanion.sourceStart !== existingCompanion.sourceStart
      || normalizedCompanion.sourceEnd !== existingCompanion.sourceEnd
      || normalizedCompanion.sourceDuration !== existingCompanion.sourceDuration
      || normalizedCompanion.sourceFps !== existingCompanion.sourceFps
      || normalizedCompanion.speed !== existingCompanion.speed
      || normalizedCompanion.src !== existingCompanion.src
    ) {
      changed = true;
    }
  }

  if (!changed) {
    return { project, repaired: false };
  }

  return {
    repaired: true,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: tracks as typeof project.timeline.tracks,
        items: items as typeof project.timeline.items,
      },
    },
  };
}

async function repairLegacyProjectAvLayouts(project: Project): Promise<{ project: Project; repaired: boolean }> {
  if (!project.timeline) {
    return { project, repaired: false };
  }

  const videoMediaIds = collectVideoMediaIds(project);
  const videoHasAudioByMediaId = videoMediaIds.length > 0
    ? await buildVideoHasAudioMap(videoMediaIds)
    : {};
  const rootItems = (project.timeline.items ?? []) as TimelineItem[];
  const rootRepair = needsLegacyAvTrackLayoutRepair({
    tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
    items: rootItems,
  })
    ? repairLegacyAvTrackLayout({
        tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
        items: rootItems,
        keyframes: (project.timeline.keyframes ?? []) as ItemKeyframes[],
        fps: project.metadata.fps,
        videoHasAudioByMediaId,
      })
    : {
        tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
        items: rootItems,
        keyframes: (project.timeline.keyframes ?? []) as ItemKeyframes[],
        changed: false,
      };
  const repairedCompositions = (project.timeline.compositions ?? []).map((composition) => {
    const compositionTracks = composition.tracks as TimelineTrack[];
    const compositionItems = composition.items as TimelineItem[];
    const repair = needsLegacyAvTrackLayoutRepair({
      tracks: compositionTracks,
      items: compositionItems,
    })
      ? repairLegacyAvTrackLayout({
          tracks: compositionTracks,
          items: compositionItems,
          keyframes: (composition.keyframes ?? []) as ItemKeyframes[],
          fps: composition.fps,
          videoHasAudioByMediaId,
        })
      : {
          tracks: compositionTracks,
          items: compositionItems,
          keyframes: (composition.keyframes ?? []) as ItemKeyframes[],
          changed: false,
        };

    return {
      repair,
      composition: repair.changed
        ? {
          ...composition,
          tracks: repair.tracks as typeof composition.tracks,
          items: repair.items as typeof composition.items,
          keyframes: repair.keyframes as typeof composition.keyframes,
        }
        : composition,
    };
  });

  const repairedLayoutProject: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: rootRepair.tracks as typeof project.timeline.tracks,
      items: rootRepair.items as typeof project.timeline.items,
      keyframes: rootRepair.keyframes as typeof project.timeline.keyframes,
      compositions: repairedCompositions.map((entry) => entry.composition),
    },
  };
  const repairedCompoundWrappers = repairCompoundClipWrappers(repairedLayoutProject);
  const cleanedEmptyAudioTracks = cleanupRedundantEmptyClassicAudioTracks(repairedCompoundWrappers.project);

  const repaired = rootRepair.changed
    || repairedCompositions.some((entry) => entry.repair.changed)
    || repairedCompoundWrappers.repaired
    || cleanedEmptyAudioTracks.cleaned;
  if (!repaired) {
    return { project, repaired: false };
  }

  return {
    repaired: true,
    project: cleanedEmptyAudioTracks.project,
  };
}

/**
 * Save timeline to project in IndexedDB.
 */
export async function saveTimeline(projectId: string): Promise<void> {
  const opId = createOperationId();
  const event = logger.startEvent('saveTimeline', opId);
  event.set('projectId', projectId);

  // If currently editing a sub-composition, navigate back to root to save
  // the main timeline data, then restore the full breadcrumb path after save completes.
  const navStore = useCompositionNavigationStore.getState();
  const previousBreadcrumbs = navStore.breadcrumbs
    .filter((breadcrumb) => breadcrumb.compositionId !== null)
    .map((breadcrumb) => ({
      compositionId: breadcrumb.compositionId!,
      label: breadcrumb.label,
      entryItemId: breadcrumb.entryItemId,
    }));
  if (previousBreadcrumbs.length > 0) {
    navStore.resetToRoot();
  }

  const restoreCompositionPath = () => {
    for (const breadcrumb of previousBreadcrumbs) {
      useCompositionNavigationStore.getState().enterComposition(
        breadcrumb.compositionId,
        breadcrumb.label,
        breadcrumb.entryItemId,
      );
    }
  };

  // Read directly from domain stores
  const itemsState = useItemsStore.getState();
  const transitionsState = useTransitionsStore.getState();
  const keyframesState = useKeyframesStore.getState();
  const markersState = useMarkersStore.getState();
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const busAudioEq = usePlaybackStore.getState().busAudioEq;
    const masterBusDb = usePlaybackStore.getState().masterBusDb;
    const zoomLevel = useZoomStore.getState().level;

  event.merge({
    itemCount: itemsState.items.length,
    trackCount: itemsState.tracks.length,
    transitionCount: transitionsState.transitions.length,
    keyframeCount: keyframesState.keyframes.length,
    currentFrame,
  });

  try {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    event.merge({
      fps: project.metadata?.fps,
      width: project.metadata?.width,
      height: project.metadata?.height,
    });

    const settingsState = useTimelineSettingsStore.getState();

    // Build timeline data (fps is stored in project.metadata, not timeline)
    const timeline: ProjectTimeline = {
      tracks: itemsState.tracks as ProjectTimeline['tracks'],
      items: itemsState.items as ProjectTimeline['items'],
      ...(busAudioEq && { busAudioEq }),
      masterBusDb,
      currentFrame,
      zoomLevel,
      scrollPosition: settingsState.scrollPosition,
      ...(markersState.inPoint !== null && { inPoint: markersState.inPoint }),
      ...(markersState.outPoint !== null && { outPoint: markersState.outPoint }),
      ...(markersState.markers.length > 0 && {
        markers: markersState.markers.map((m) => ({
          id: m.id,
          frame: m.frame,
          color: m.color,
          ...(m.label && { label: m.label }),
        })),
      }),
      ...(transitionsState.transitions.length > 0 && {
        transitions: transitionsState.transitions.map(cloneTransitionForProject),
      }),
      ...(keyframesState.keyframes.length > 0 && {
        keyframes: keyframesState.keyframes.map((ik) => ({
          itemId: ik.itemId,
          properties: ik.properties.map((pk) => ({
            property: pk.property,
            keyframes: pk.keyframes.map((k) => ({
              id: k.id,
              frame: k.frame,
              value: k.value,
              easing: k.easing,
              ...(k.easingConfig && { easingConfig: k.easingConfig }),
            })),
          })),
        })),
      }),
      // Sub-compositions (pre-comps)
      ...(() => {
        const comps = useCompositionsStore.getState().compositions;
        if (comps.length === 0) return {};
        return {
          compositions: comps.map((c) => ({
            id: c.id,
            name: c.name,
            items: c.items as ProjectTimeline['items'],
            tracks: c.tracks as ProjectTimeline['tracks'],
            ...(c.transitions?.length && {
              transitions: c.transitions.map(cloneTransitionForProject) as ProjectTimeline['transitions'],
            }),
            ...(c.keyframes?.length && { keyframes: c.keyframes as ProjectTimeline['keyframes'] }),
            fps: c.fps,
            width: c.width,
            height: c.height,
            durationInFrames: c.durationInFrames,
            ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
            ...(c.busAudioEq && { busAudioEq: c.busAudioEq }),
          })),
        };
      })(),
    };
    const { timeline: sanitizedTimeline } = sanitizeTimelineEphemeralFields(timeline);

    // Generate thumbnail — prefer capturing the existing preview canvas
    // (near-free: reuses the already-initialized scrub renderer with cached
    // media + GPU pipeline) and fall back to a full renderSingleFrame only
    // when the preview capture path is unavailable.
    let thumbnailId: string | undefined;
    if (itemsState.items.length > 0) {
      try {
        const width = project.metadata?.width || 1920;
        const height = project.metadata?.height || 1080;

        // Calculate thumbnail dimensions preserving project aspect ratio
        const maxThumbWidth = 320;
        const maxThumbHeight = 180;
        const projectAspectRatio = width / height;
        const targetAspectRatio = maxThumbWidth / maxThumbHeight;

        let thumbWidth: number;
        let thumbHeight: number;
        if (projectAspectRatio > targetAspectRatio) {
          thumbWidth = maxThumbWidth;
          thumbHeight = Math.round(maxThumbWidth / projectAspectRatio);
        } else {
          thumbHeight = maxThumbHeight;
          thumbWidth = Math.round(maxThumbHeight * projectAspectRatio);
        }

        let thumbnailBlob: Blob | null = null;

        // Fast path: capture from existing preview renderer (avoids full re-init)
        const captureCanvasSource = usePreviewBridgeStore.getState().captureCanvasSource;
        if (captureCanvasSource) {
          try {
            const sourceCanvas = await captureCanvasSource();
            if (sourceCanvas) {
              thumbnailBlob = await scaleCanvasToBlob(sourceCanvas, thumbWidth, thumbHeight, 0.85);
            }
          } catch {
            // Fall through to slow path
          }
        }

        // Slow path: full render from scratch (when preview isn't available)
        if (!thumbnailBlob) {
          const fps = project.metadata?.fps || 30;
          const backgroundColor = project.metadata?.backgroundColor;
          const composition = convertTimelineToComposition(
            itemsState.tracks,
            itemsState.items,
            transitionsState.transitions,
            fps,
            width,
            height,
            null, null,
            keyframesState.keyframes,
            backgroundColor
          );
          const resolvedTracks = await resolveMediaUrls(composition.tracks);
          const resolvedComposition = { ...composition, tracks: resolvedTracks };
          thumbnailBlob = await renderSingleFrame({
            composition: resolvedComposition,
            frame: currentFrame,
            width: thumbWidth,
            height: thumbHeight,
            quality: 0.85,
            format: 'image/jpeg',
          });
        }

        // Save thumbnail to IndexedDB
        thumbnailId = `project:${projectId}:cover`;
        await saveThumbnail({
          id: thumbnailId,
          mediaId: projectId,
          blob: thumbnailBlob,
          timestamp: Date.now(),
          width: thumbWidth,
          height: thumbHeight,
        });
      } catch (thumbError) {
        // Thumbnail generation failure shouldn't block save
        event.set('thumbnailError', thumbError instanceof Error ? thumbError.message : String(thumbError));
      }
    }

    // Update project
    // Clear deprecated thumbnail field when using thumbnailId to save space
    await updateProject(projectId, {
      timeline: sanitizedTimeline,
      ...(thumbnailId && { thumbnailId, thumbnail: undefined }),
      updatedAt: Date.now(),
    });

    // Mark as clean after successful save
    useTimelineSettingsStore.getState().markClean();

    const updatedAt = Date.now();
    event.success({ updatedAt, thumbnailId });

    // Re-enter the sub-composition the user was editing before save
    if (previousBreadcrumbs.length > 0) {
      restoreCompositionPath();
    }
  } catch (error) {
    event.failure(error);
    // Re-enter even on failure so user doesn't lose their editing context
    if (previousBreadcrumbs.length > 0) {
      restoreCompositionPath();
    }
    throw error;
  }
}

/**
 * Load timeline from project in IndexedDB.
 * Single source of truth for all timeline loading (project open, refresh, etc.)
 *
 * This function:
 * 1. Loads the project from storage
 * 2. Runs migrations if the project schema is outdated
 * 3. Normalizes data to apply current defaults
 * 4. Persists migrated projects back to storage
 * 5. Restores timeline state to stores
 */
export async function loadTimeline(
  projectId: string,
  options: LoadTimelineOptions = {}
): Promise<void> {
  // Mark loading started - used to coordinate initial player sync
  useTimelineSettingsStore.getState().setTimelineLoading(true);

  try {
    const rawProject = await getProject(projectId);
    if (!rawProject) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const storedSchemaVersion = rawProject.schemaVersion ?? 1;
    const requiresUpgrade = storedSchemaVersion < CURRENT_SCHEMA_VERSION;
    if (requiresUpgrade && !options.allowProjectUpgrade) {
      throw new Error(
        `Project schema v${storedSchemaVersion} requires confirmation before upgrading to v${CURRENT_SCHEMA_VERSION}`
      );
    }

    // Run migrations and normalization
    const migrationResult = migrateProject(rawProject);
    const repairedLegacyLayouts = await repairLegacyProjectAvLayouts(migrationResult.project);
    const sanitizedTimeline = repairedLegacyLayouts.project.timeline
      ? sanitizeTimelineEphemeralFields(repairedLegacyLayouts.project.timeline)
      : { timeline: repairedLegacyLayouts.project.timeline, cleaned: false };
    const project = sanitizedTimeline.cleaned
      ? {
        ...repairedLegacyLayouts.project,
        timeline: sanitizedTimeline.timeline,
      }
      : repairedLegacyLayouts.project;

    // Log migration activity
    if (migrationResult.migrated || repairedLegacyLayouts.repaired || sanitizedTimeline.cleaned) {
      if (migrationResult.appliedMigrations.length > 0) {
        logger.info(
          `Migrated project from v${migrationResult.fromVersion} to v${migrationResult.toVersion}`,
          { migrations: migrationResult.appliedMigrations }
        );
      } else if (sanitizedTimeline.cleaned) {
        logger.info('Removed ephemeral thumbnail URLs from stored timeline items', { projectId });
      } else if (repairedLegacyLayouts.repaired) {
        logger.info('Repaired legacy A/V track layout for project', { projectId });
      } else {
        logger.debug('Project normalized with current defaults');
      }

      // Persist migrated project back to storage
      await updateProject(projectId, {
        ...project,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      logger.debug('Saved migrated project to storage');
    }

    if (project.timeline && project.timeline.tracks?.length > 0) {
      const t = project.timeline;

      logger.debug('loadTimeline: loading existing timeline', {
        tracksCount: t.tracks?.length ?? 0,
        itemsCount: t.items?.length ?? 0,
        keyframesCount: t.keyframes?.length ?? 0,
        transitionsCount: t.transitions?.length ?? 0,
        schemaVersion: project.schemaVersion ?? 1,
      });

      // Restore tracks and items from project
      // Sort tracks by order property to preserve user's track arrangement
      const sortedTracks = [...(t.tracks || [])]
        .map((track, index) => ({ track, originalIndex: index }))
        .sort((a, b) => (a.track.order ?? a.originalIndex) - (b.track.order ?? b.originalIndex))
        .map(({ track }) => ({
          ...track,
          items: [], // Items are stored separately
        }));

      // Restore all state to domain stores
      const projectFps = project.metadata?.fps || 30;
      const sanitizedInOutPoints = sanitizeInOutPoints({
        inPoint: t.inPoint ?? null,
        outPoint: t.outPoint ?? null,
        maxFrame: getEffectiveTimelineMaxFrame((t.items || []) as TimelineItem[], projectFps),
      });
      useItemsStore.getState().setTracks(sortedTracks as TimelineTrack[]);
      useItemsStore.getState().setItems((t.items || []) as TimelineItem[]);
      useTransitionsStore.getState().setTransitions((t.transitions || []) as Transition[]);
      useKeyframesStore.getState().setKeyframes((t.keyframes || []) as ItemKeyframes[]);
      useMarkersStore.getState().setMarkers(t.markers || []);
      useMarkersStore.getState().setInPoint(sanitizedInOutPoints.inPoint);
      useMarkersStore.getState().setOutPoint(sanitizedInOutPoints.outPoint);
      useTimelineSettingsStore.getState().setScrollPosition(t.scrollPosition || 0);
      usePlaybackStore.getState().setBusAudioEq(t.busAudioEq);
      usePlaybackStore.getState().setMasterBusDb(t.masterBusDb ?? 0);

      // Restore sub-compositions
      if (t.compositions && t.compositions.length > 0) {
        useCompositionsStore.getState().setCompositions(
          t.compositions.map((c) => ({
            id: c.id,
            name: c.name,
            items: c.items as TimelineItem[],
            tracks: c.tracks as TimelineTrack[],
            transitions: (c.transitions ?? []) as Transition[],
            keyframes: (c.keyframes ?? []) as ItemKeyframes[],
            fps: c.fps,
            width: c.width,
            height: c.height,
            durationInFrames: c.durationInFrames,
            ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
            ...(c.busAudioEq && { busAudioEq: c.busAudioEq }),
          }))
        );
      } else {
        useCompositionsStore.getState().setCompositions([]);
      }

      // Reset composition navigation to root on load
      useCompositionNavigationStore.getState().resetToRoot();

      // Restore zoom and playback
      if (t.zoomLevel !== undefined) {
        useZoomStore.getState().setZoomLevel(t.zoomLevel);
      } else {
        useZoomStore.getState().setZoomLevel(1);
      }
      if (t.currentFrame !== undefined) {
        usePlaybackStore.getState().setCurrentFrame(t.currentFrame);
      } else {
        usePlaybackStore.getState().setCurrentFrame(0);
      }
    } else {
      logger.debug('loadTimeline: initializing new project with default track');

      // Initialize with default tracks for new projects
      useItemsStore.getState().setTracks(createDefaultClassicTracks(DEFAULT_TRACK_HEIGHT));
      useItemsStore.getState().setItems([]);
      useTransitionsStore.getState().setTransitions([]);
      useKeyframesStore.getState().setKeyframes([]);
      useMarkersStore.getState().setMarkers([]);
      useMarkersStore.getState().setInPoint(null);
      useMarkersStore.getState().setOutPoint(null);
      useCompositionsStore.getState().setCompositions([]);
      useCompositionNavigationStore.getState().resetToRoot();
      useTimelineSettingsStore.getState().setScrollPosition(0);
      useZoomStore.getState().setZoomLevel(1);
      usePlaybackStore.getState().setCurrentFrame(0);
      usePlaybackStore.getState().setBusAudioEq(undefined);
    }

    // Common setup for both cases
    // fps is stored in project.metadata, not timeline
    useTimelineSettingsStore.getState().setFps(project.metadata?.fps || 30);
    // snapEnabled is UI state, seeded from the app-level default
    useTimelineSettingsStore.getState().setSnapEnabled(useSettingsStore.getState().snapEnabled);
    useTimelineSettingsStore.getState().markClean();

    // Clear undo history when loading
    useTimelineCommandStore.getState().clearHistory();

    // Validate media references after loading timeline
    const loadedItems = useItemsStore.getState().items;
    const orphans = await validateProjectMediaReferences({
      rootItems: loadedItems,
      compositions: useCompositionsStore.getState().compositions,
      projectId,
    });
    if (orphans.length > 0) {
      logger.warn(`Found ${orphans.length} orphaned clip(s) referencing deleted media`);
      useMediaLibraryStore.getState().setOrphanedClips(orphans);
      useMediaLibraryStore.getState().openOrphanedClipsDialog();
    } else {
      useMediaLibraryStore.getState().closeOrphanedClipsDialog();
      useMediaLibraryStore.getState().setOrphanedClips([]);
    }

    // Mark loading complete - signals player sync can proceed
    useTimelineSettingsStore.getState().setTimelineLoading(false);
  } catch (error) {
    logger.error('Failed to load timeline:', error);
    // Still mark loading complete on error so UI isn't stuck
    useTimelineSettingsStore.getState().setTimelineLoading(false);
    throw error;
  }
}
