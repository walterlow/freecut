import type {
  MediaReference,
  ProjectSnapshot,
  Timeline,
  TimelineItem,
  Transition,
} from './types.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: ValidationFinding[];
}

export interface ValidateSnapshotOptions {
  /** Warn when media-backed items reference media ids missing from mediaReferences. */
  warnOnMissingMedia?: boolean;
}

const SOURCE_TIMED_TYPES = new Set(['video', 'audio', 'composition']);
const MEDIA_TYPES = new Set(['video', 'audio', 'image']);

export function validateSnapshot(
  snapshot: ProjectSnapshot,
  opts: ValidateSnapshotOptions = {},
): ValidationResult {
  const findings: ValidationFinding[] = [];
  const warnOnMissingMedia = opts.warnOnMissingMedia ?? true;

  const push = (finding: ValidationFinding) => findings.push(finding);
  const error = (code: string, message: string, path?: string, entityId?: string) =>
    push({ severity: 'error', code, message, path, entityId });
  const warning = (code: string, message: string, path?: string, entityId?: string) =>
    push({ severity: 'warning', code, message, path, entityId });

  if (!snapshot || typeof snapshot !== 'object') {
    error('snapshot_invalid', 'snapshot must be an object');
    return summarize(findings);
  }

  if (snapshot.version !== '1.0') {
    warning('snapshot_version_unknown', `snapshot version is "${snapshot.version}", expected "1.0"`, 'version');
  }

  if (!snapshot.project) {
    error('project_missing', 'snapshot.project is required', 'project');
    return summarize(findings);
  }

  const metadata = snapshot.project.metadata;
  if (!metadata) {
    error('metadata_missing', 'project.metadata is required', 'project.metadata');
  } else {
    positiveInt(metadata.width, 'project.metadata.width', 'metadata_width_invalid', 'project width must be a positive integer');
    positiveInt(metadata.height, 'project.metadata.height', 'metadata_height_invalid', 'project height must be a positive integer');
    positiveInt(metadata.fps, 'project.metadata.fps', 'metadata_fps_invalid', 'project fps must be a positive integer');
  }

  if (!Array.isArray(snapshot.mediaReferences)) {
    error('media_references_invalid', 'snapshot.mediaReferences must be an array', 'mediaReferences');
    return summarize(findings);
  }

  const mediaIds = validateMediaReferences(snapshot.mediaReferences, push);
  const timeline = snapshot.project.timeline;
  if (!timeline) {
    warning('timeline_missing', 'project.timeline is missing; editor will open an empty timeline', 'project.timeline');
    return summarize(findings);
  }

  validateTimeline(timeline, { mediaIds, warnOnMissingMedia, error, warning });
  return summarize(findings);

  function positiveInt(value: unknown, path: string, code: string, message: string) {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      error(code, `${message}, got ${String(value)}`, path);
    }
  }
}

export function lintSnapshot(
  snapshot: ProjectSnapshot,
  opts: ValidateSnapshotOptions = {},
): ValidationResult {
  return validateSnapshot(snapshot, opts);
}

function validateMediaReferences(
  mediaReferences: MediaReference[],
  push: (finding: ValidationFinding) => void,
): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<string>();

  mediaReferences.forEach((media, index) => {
    const path = `mediaReferences[${index}]`;
    if (!media.id) {
      push({ severity: 'error', code: 'media_id_missing', message: 'media reference id is required', path });
      return;
    }
    if (seen.has(media.id)) {
      push({
        severity: 'error',
        code: 'duplicate_id',
        message: `duplicate media id "${media.id}"`,
        path: `${path}.id`,
        entityId: media.id,
      });
    }
    seen.add(media.id);
    ids.add(media.id);

    if (!media.fileName) {
      push({
        severity: 'error',
        code: 'media_file_name_missing',
        message: `media "${media.id}" is missing fileName`,
        path: `${path}.fileName`,
        entityId: media.id,
      });
    }
    if (media.duration < 0) {
      push({
        severity: 'error',
        code: 'media_duration_invalid',
        message: `media "${media.id}" duration must be non-negative`,
        path: `${path}.duration`,
        entityId: media.id,
      });
    }
  });

  return ids;
}

function validateTimeline(
  timeline: Timeline,
  ctx: {
    mediaIds: Set<string>;
    warnOnMissingMedia: boolean;
    error: (code: string, message: string, path?: string, entityId?: string) => void;
    warning: (code: string, message: string, path?: string, entityId?: string) => void;
  },
) {
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
  const items = Array.isArray(timeline.items) ? timeline.items : [];
  const transitions = Array.isArray(timeline.transitions) ? timeline.transitions : [];
  const markers = Array.isArray(timeline.markers) ? timeline.markers : [];

  if (!Array.isArray(timeline.tracks)) ctx.error('tracks_invalid', 'timeline.tracks must be an array', 'project.timeline.tracks');
  if (!Array.isArray(timeline.items)) ctx.error('items_invalid', 'timeline.items must be an array', 'project.timeline.items');
  if (timeline.transitions !== undefined && !Array.isArray(timeline.transitions)) {
    ctx.error('transitions_invalid', 'timeline.transitions must be an array', 'project.timeline.transitions');
  }
  if (timeline.markers !== undefined && !Array.isArray(timeline.markers)) {
    ctx.error('markers_invalid', 'timeline.markers must be an array', 'project.timeline.markers');
  }

  const allIds = new Set<string>();
  const trackIds = new Set<string>();
  const itemIds = new Set<string>();

  tracks.forEach((track, index) => {
    const path = `project.timeline.tracks[${index}]`;
    checkId(track.id, path, allIds, ctx.error);
    if (track.id) trackIds.add(track.id);
    if (!track.name) ctx.warning('track_name_missing', `track "${track.id}" has no name`, `${path}.name`, track.id);
    if (!Number.isFinite(track.order)) {
      ctx.error('track_order_invalid', `track "${track.id}" order must be a number`, `${path}.order`, track.id);
    }
  });

  items.forEach((item, index) => {
    const path = `project.timeline.items[${index}]`;
    checkId(item.id, path, allIds, ctx.error);
    if (item.id) itemIds.add(item.id);
    validateItem(item, path, trackIds, ctx);
  });

  transitions.forEach((transition, index) => {
    const path = `project.timeline.transitions[${index}]`;
    checkId(transition.id, path, allIds, ctx.error);
    validateTransition(transition, path, itemIds, items, ctx);
  });

  markers.forEach((marker, index) => {
    const path = `project.timeline.markers[${index}]`;
    checkId(marker.id, path, allIds, ctx.error);
    if (!Number.isInteger(marker.frame) || marker.frame < 0) {
      ctx.error('marker_frame_invalid', `marker "${marker.id}" frame must be a non-negative integer`, `${path}.frame`, marker.id);
    }
  });

  validateInOutPoints(timeline, ctx);
}

function validateInOutPoints(
  timeline: Timeline,
  ctx: {
    error: (code: string, message: string, path?: string, entityId?: string) => void;
    warning: (code: string, message: string, path?: string, entityId?: string) => void;
  },
) {
  const hasIn = timeline.inPoint !== undefined && timeline.inPoint !== null;
  const hasOut = timeline.outPoint !== undefined && timeline.outPoint !== null;
  if (!hasIn && !hasOut) return;
  if (hasIn !== hasOut) {
    ctx.error(
      'in_out_incomplete',
      'timeline inPoint and outPoint must be set together',
      'project.timeline',
    );
    return;
  }
  if (!Number.isInteger(timeline.inPoint) || Number(timeline.inPoint) < 0) {
    ctx.error('in_point_invalid', 'timeline inPoint must be a non-negative integer', 'project.timeline.inPoint');
  }
  if (!Number.isInteger(timeline.outPoint) || Number(timeline.outPoint) <= 0) {
    ctx.error('out_point_invalid', 'timeline outPoint must be a positive integer', 'project.timeline.outPoint');
  }
  if (
    Number.isInteger(timeline.inPoint)
    && Number.isInteger(timeline.outPoint)
    && Number(timeline.inPoint) >= Number(timeline.outPoint)
  ) {
    ctx.error('in_out_range_invalid', 'timeline inPoint must be before outPoint', 'project.timeline');
  }
  const lastFrame = (timeline.items ?? []).reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0,
  );
  if (lastFrame > 0 && Number.isInteger(timeline.outPoint) && Number(timeline.outPoint) > lastFrame) {
    ctx.warning(
      'out_point_after_timeline',
      `timeline outPoint ${timeline.outPoint} is after the last item frame ${lastFrame}`,
      'project.timeline.outPoint',
    );
  }
}

function validateItem(
  item: TimelineItem,
  path: string,
  trackIds: Set<string>,
  ctx: {
    mediaIds: Set<string>;
    warnOnMissingMedia: boolean;
    error: (code: string, message: string, path?: string, entityId?: string) => void;
    warning: (code: string, message: string, path?: string, entityId?: string) => void;
  },
) {
  if (!trackIds.has(item.trackId)) {
    ctx.error('item_track_missing', `item "${item.id}" references missing track "${item.trackId}"`, `${path}.trackId`, item.id);
  }
  if (!Number.isInteger(item.from) || item.from < 0) {
    ctx.error('item_from_invalid', `item "${item.id}" from must be a non-negative integer`, `${path}.from`, item.id);
  }
  if (!Number.isInteger(item.durationInFrames) || item.durationInFrames <= 0) {
    ctx.error('item_duration_invalid', `item "${item.id}" durationInFrames must be a positive integer`, `${path}.durationInFrames`, item.id);
  }
  if (MEDIA_TYPES.has(item.type) && item.mediaId && ctx.warnOnMissingMedia && !ctx.mediaIds.has(item.mediaId)) {
    ctx.warning('item_media_missing', `item "${item.id}" references missing media "${item.mediaId}"`, `${path}.mediaId`, item.id);
  }
  if (item.type === 'text' && !item.text) {
    ctx.error('text_required', `text item "${item.id}" requires text`, `${path}.text`, item.id);
  }
  if (item.type === 'shape' && !item.shapeType) {
    ctx.error('shape_type_required', `shape item "${item.id}" requires shapeType`, `${path}.shapeType`, item.id);
  }
  if (SOURCE_TIMED_TYPES.has(item.type)) {
    validateSourceTiming(item, path, ctx);
  }
  if (item.transform?.opacity !== undefined && (item.transform.opacity < 0 || item.transform.opacity > 1)) {
    ctx.error('opacity_range', `item "${item.id}" opacity must be between 0 and 1`, `${path}.transform.opacity`, item.id);
  }
}

function validateSourceTiming(
  item: TimelineItem,
  path: string,
  ctx: {
    error: (code: string, message: string, path?: string, entityId?: string) => void;
  },
) {
  if (item.sourceStart !== undefined && (!Number.isInteger(item.sourceStart) || item.sourceStart < 0)) {
    ctx.error('source_start_invalid', `item "${item.id}" sourceStart must be a non-negative integer`, `${path}.sourceStart`, item.id);
  }
  if (item.sourceEnd !== undefined && (!Number.isInteger(item.sourceEnd) || item.sourceEnd < 0)) {
    ctx.error('source_end_invalid', `item "${item.id}" sourceEnd must be a non-negative integer`, `${path}.sourceEnd`, item.id);
  }
  if (item.sourceStart !== undefined && item.sourceEnd !== undefined && item.sourceEnd < item.sourceStart) {
    ctx.error('source_range_invalid', `item "${item.id}" sourceEnd must be >= sourceStart`, `${path}.sourceEnd`, item.id);
  }
  if (item.speed !== undefined && (!Number.isFinite(item.speed) || item.speed <= 0)) {
    ctx.error('speed_invalid', `item "${item.id}" speed must be positive`, `${path}.speed`, item.id);
  }
}

function validateTransition(
  transition: Transition,
  path: string,
  itemIds: Set<string>,
  items: TimelineItem[],
  ctx: {
    error: (code: string, message: string, path?: string, entityId?: string) => void;
    warning: (code: string, message: string, path?: string, entityId?: string) => void;
  },
) {
  if (!itemIds.has(transition.leftClipId)) {
    ctx.error('transition_left_missing', `transition "${transition.id}" references missing left clip`, `${path}.leftClipId`, transition.id);
  }
  if (!itemIds.has(transition.rightClipId)) {
    ctx.error('transition_right_missing', `transition "${transition.id}" references missing right clip`, `${path}.rightClipId`, transition.id);
  }
  if (!Number.isInteger(transition.durationInFrames) || transition.durationInFrames <= 0) {
    ctx.error('transition_duration_invalid', `transition "${transition.id}" durationInFrames must be positive`, `${path}.durationInFrames`, transition.id);
  }

  const left = items.find((item) => item.id === transition.leftClipId);
  const right = items.find((item) => item.id === transition.rightClipId);
  if (!left || !right) return;
  if (left.trackId !== right.trackId) {
    ctx.error('transition_track_mismatch', `transition "${transition.id}" clips must be on the same track`, path, transition.id);
  }
  if (transition.trackId !== left.trackId) {
    ctx.error('transition_track_invalid', `transition "${transition.id}" trackId does not match its clips`, `${path}.trackId`, transition.id);
  }
  const leftEnd = left.from + left.durationInFrames;
  if (leftEnd !== right.from) {
    ctx.warning(
      'transition_not_adjacent',
      `transition "${transition.id}" clips are not adjacent (${leftEnd} -> ${right.from})`,
      path,
      transition.id,
    );
  }
}

function checkId(
  id: string,
  path: string,
  allIds: Set<string>,
  error: (code: string, message: string, path?: string, entityId?: string) => void,
) {
  if (!id) {
    error('id_missing', 'id is required', `${path}.id`);
    return;
  }
  if (allIds.has(id)) {
    error('duplicate_id', `duplicate id "${id}"`, `${path}.id`, id);
  }
  allIds.add(id);
}

function summarize(findings: ValidationFinding[]): ValidationResult {
  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const infoCount = findings.filter((finding) => finding.severity === 'info').length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}
