import type { TimelineTrack } from '@/types/timeline';
import {
  createClassicTrack,
  getAdjacentTrackOrder,
  getTrackKind,
  renameTrackForKind,
  type TrackKind,
} from './classic-tracks';

interface EnsureTrackForKindParams {
  tracks: TimelineTrack[];
  targetTrack: TimelineTrack;
  kind: TrackKind;
  directionWhenCreating: 'above' | 'below';
  preferredTrackHeight: number;
  preferTarget?: boolean;
}

export interface SourceEditTrackTargets {
  tracks: TimelineTrack[];
  videoTrackId?: string;
  audioTrackId?: string;
}

function findFirstUnlockedTrackByKind(
  tracks: TimelineTrack[],
  kind: TrackKind,
): TimelineTrack | null {
  return [...tracks]
    .filter((track) => !track.locked && !track.isGroup && getTrackKind(track) === kind)
    .sort((a, b) => a.order - b.order)[0] ?? null;
}

function findUnlockedTrackById(
  tracks: TimelineTrack[],
  trackId: string | null | undefined,
): TimelineTrack | null {
  if (!trackId) return null;
  const track = tracks.find((candidate) => candidate.id === trackId);
  return track && !track.locked && !track.isGroup ? track : null;
}

function canUseTrackForKind(track: TimelineTrack | null, kind: TrackKind): track is TimelineTrack {
  if (!track || track.locked || track.isGroup) {
    return false;
  }

  const trackKind = getTrackKind(track);
  return trackKind === kind || trackKind === null;
}

function createStandaloneTrackForKind(params: {
  tracks: TimelineTrack[];
  kind: TrackKind;
  preferredTrackHeight: number;
}): { tracks: TimelineTrack[]; trackId: string } {
  const { tracks, kind, preferredTrackHeight } = params;
  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);
  const defaultOrder = kind === 'video'
    ? ((sortedTracks[0]?.order ?? 1) - 1)
    : ((sortedTracks.at(-1)?.order ?? 0) + 1);
  const createdTrack = createClassicTrack({
    tracks,
    kind,
    order: defaultOrder,
    height: preferredTrackHeight,
  });

  return {
    tracks: [...tracks, createdTrack],
    trackId: createdTrack.id,
  };
}

function resolveTargetTrackForKind(params: {
  tracks: TimelineTrack[];
  kind: TrackKind;
  preferredTrackId?: string | null;
  fallbackTrack?: TimelineTrack | null;
  creationReferenceTrack?: TimelineTrack | null;
  directionWhenCreating: 'above' | 'below';
  preferredTrackHeight: number;
}): { tracks: TimelineTrack[]; trackId: string } {
  const {
    tracks,
    kind,
    preferredTrackId,
    fallbackTrack = null,
    creationReferenceTrack = null,
    directionWhenCreating,
    preferredTrackHeight,
  } = params;

  const preferredTrack = findUnlockedTrackById(tracks, preferredTrackId);
  if (canUseTrackForKind(preferredTrack, kind)) {
    return ensureTrackForKind({
      tracks,
      targetTrack: preferredTrack,
      kind,
      directionWhenCreating,
      preferredTrackHeight,
      preferTarget: true,
    });
  }

  if (canUseTrackForKind(fallbackTrack, kind)) {
    return ensureTrackForKind({
      tracks,
      targetTrack: fallbackTrack,
      kind,
      directionWhenCreating,
      preferredTrackHeight,
      preferTarget: true,
    });
  }

  const existingTrack = findFirstUnlockedTrackByKind(tracks, kind);
  if (existingTrack) {
    return { tracks, trackId: existingTrack.id };
  }

  if (creationReferenceTrack) {
    return ensureTrackForKind({
      tracks,
      targetTrack: creationReferenceTrack,
      kind,
      directionWhenCreating,
      preferredTrackHeight,
      preferTarget: false,
    });
  }

  return createStandaloneTrackForKind({
    tracks,
    kind,
    preferredTrackHeight,
  });
}

function findNearestUnlockedTrackByKind(
  tracks: TimelineTrack[],
  targetTrack: TimelineTrack,
  kind: TrackKind,
  direction: 'above' | 'below'
): TimelineTrack | null {
  const candidates = tracks
    .filter((track) => !track.locked && !track.isGroup && getTrackKind(track) === kind)
    .filter((track) => direction === 'above'
      ? track.order < targetTrack.order
      : track.order > targetTrack.order)
    .sort((a, b) => direction === 'above' ? b.order - a.order : a.order - b.order);

  return candidates[0] ?? null;
}

function ensureTrackForKind(params: EnsureTrackForKindParams): { tracks: TimelineTrack[]; trackId: string } {
  const {
    tracks,
    targetTrack,
    kind,
    directionWhenCreating,
    preferredTrackHeight,
    preferTarget = false,
  } = params;

  if (targetTrack.locked) {
    const existingTrack = findNearestUnlockedTrackByKind(tracks, targetTrack, kind, directionWhenCreating);
    if (existingTrack) {
      return { tracks, trackId: existingTrack.id };
    }

    const createdTrack = createClassicTrack({
      tracks,
      kind,
      order: getAdjacentTrackOrder(tracks, targetTrack, directionWhenCreating),
      height: preferredTrackHeight,
    });

    return {
      tracks: [...tracks, createdTrack],
      trackId: createdTrack.id,
    };
  }

  const targetKind = getTrackKind(targetTrack);

  if (preferTarget || targetKind === kind || targetKind === null) {
    const upgradedTrack = renameTrackForKind(targetTrack, tracks, kind);
    if (upgradedTrack === targetTrack) {
      return { tracks, trackId: targetTrack.id };
    }

    return {
      tracks: tracks.map((track) => track.id === targetTrack.id ? upgradedTrack : track),
      trackId: targetTrack.id,
    };
  }

  const existingTrack = findNearestUnlockedTrackByKind(tracks, targetTrack, kind, directionWhenCreating);
  if (existingTrack) {
    return { tracks, trackId: existingTrack.id };
  }

  const createdTrack = createClassicTrack({
    tracks,
    kind,
    order: getAdjacentTrackOrder(tracks, targetTrack, directionWhenCreating),
    height: preferredTrackHeight,
  });

  return {
    tracks: [...tracks, createdTrack],
    trackId: createdTrack.id,
  };
}

export function resolveSourceEditTrackTargets(params: {
  tracks: TimelineTrack[];
  activeTrackId?: string | null;
  preferredVideoTrackId?: string | null;
  preferredAudioTrackId?: string | null;
  mediaType: 'video' | 'audio' | 'image';
  hasAudio: boolean;
  patchVideo: boolean;
  patchAudio: boolean;
  preferredTrackHeight: number;
}): SourceEditTrackTargets | null {
  const {
    tracks,
    activeTrackId = null,
    preferredVideoTrackId = null,
    preferredAudioTrackId = null,
    mediaType,
    hasAudio,
    patchVideo,
    patchAudio,
    preferredTrackHeight,
  } = params;
  const activeTrack = activeTrackId
    ? (tracks.find((track) => track.id === activeTrackId && !track.isGroup) ?? null)
    : null;
  const activeKind = activeTrack ? getTrackKind(activeTrack) : null;
  const referenceTrack = activeTrack
    ?? findUnlockedTrackById(tracks, preferredVideoTrackId)
    ?? findUnlockedTrackById(tracks, preferredAudioTrackId)
    ?? null;
  const wantsVideo = (mediaType === 'video' || mediaType === 'image') && patchVideo;
  const wantsAudio = ((mediaType === 'video' && hasAudio) || mediaType === 'audio') && patchAudio;

  if (!wantsVideo && !wantsAudio) {
    return null;
  }

  if (mediaType === 'audio') {
    if (!wantsAudio) {
      return null;
    }

    const audioTarget = resolveTargetTrackForKind({
      tracks,
      kind: 'audio',
      preferredTrackId: preferredAudioTrackId,
      fallbackTrack: activeKind === 'audio' || activeKind === null ? activeTrack : null,
      creationReferenceTrack: referenceTrack,
      directionWhenCreating: 'below',
      preferredTrackHeight,
    });

    return {
      tracks: audioTarget.tracks,
      audioTrackId: audioTarget.trackId,
    };
  }

  if (!wantsAudio) {
    if (!wantsVideo) {
      return null;
    }

    const videoTarget = resolveTargetTrackForKind({
      tracks,
      kind: 'video',
      preferredTrackId: preferredVideoTrackId,
      fallbackTrack: activeKind === 'video' || activeKind === null ? activeTrack : null,
      creationReferenceTrack: referenceTrack,
      directionWhenCreating: 'above',
      preferredTrackHeight,
    });

    return {
      tracks: videoTarget.tracks,
      videoTrackId: videoTarget.trackId,
    };
  }

  if (!wantsVideo) {
    const audioTarget = resolveTargetTrackForKind({
      tracks,
      kind: 'audio',
      preferredTrackId: preferredAudioTrackId,
      fallbackTrack: activeKind === 'audio' || activeKind === null ? activeTrack : null,
      creationReferenceTrack: referenceTrack,
      directionWhenCreating: 'below',
      preferredTrackHeight,
    });

    return {
      tracks: audioTarget.tracks,
      audioTrackId: audioTarget.trackId,
    };
  }

  const videoTarget = resolveTargetTrackForKind({
    tracks,
    kind: 'video',
    preferredTrackId: preferredVideoTrackId,
    fallbackTrack: activeKind === 'video' || activeKind === null ? activeTrack : null,
    creationReferenceTrack: referenceTrack,
    directionWhenCreating: 'above',
    preferredTrackHeight,
  });
  const resolvedVideoTrack = videoTarget.tracks.find((track) => track.id === videoTarget.trackId) ?? referenceTrack;
  const audioTarget = resolveTargetTrackForKind({
    tracks: videoTarget.tracks,
    kind: 'audio',
    preferredTrackId: preferredAudioTrackId,
    fallbackTrack: activeKind === 'audio' ? activeTrack : null,
    creationReferenceTrack: resolvedVideoTrack,
    directionWhenCreating: 'below',
    preferredTrackHeight,
  });

  if (!resolvedVideoTrack) {
    return null;
  }

  return {
    tracks: audioTarget.tracks,
    videoTrackId: videoTarget.trackId,
    audioTrackId: audioTarget.trackId,
  };
}
