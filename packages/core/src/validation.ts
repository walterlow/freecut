const SOURCE_TIMED_TYPES = new Set(['video', 'audio', 'composition']);
const MEDIA_TYPES = new Set(['video', 'audio', 'image']);

export type SnapshotFindingSeverity = 'error' | 'warning' | 'info';

export interface SnapshotFinding {
  severity: SnapshotFindingSeverity;
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

export interface SnapshotValidationOptions {
  warnOnMissingMedia?: boolean;
}

export interface SnapshotValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: SnapshotFinding[];
}

type PushFinding = (finding: SnapshotFinding) => void;
type ReportFinding = (code: string, message: string, path?: string, entityId?: string) => void;
type JsonRecord = Record<string, unknown>;

interface ValidationContext {
  mediaIds: Set<string>;
  warnOnMissingMedia: boolean;
  error: ReportFinding;
  warning: ReportFinding;
}

export function validateSnapshot(snapshot: unknown, opts: SnapshotValidationOptions = {}): SnapshotValidationResult {
  const findings: SnapshotFinding[] = [];
  const warnOnMissingMedia = opts.warnOnMissingMedia ?? true;

  const push: PushFinding = (finding) => findings.push(finding);
  const error: ReportFinding = (code, message, path, entityId) =>
    push({ severity: 'error', code, message, path, entityId });
  const warning: ReportFinding = (code, message, path, entityId) =>
    push({ severity: 'warning', code, message, path, entityId });

  if (!snapshot || typeof snapshot !== 'object') {
    error('snapshot_invalid', 'snapshot must be an object');
    return summarize(findings);
  }
  const snapshotRecord = snapshot as JsonRecord;

  if (snapshotRecord.version !== '1.0') {
    warning('snapshot_version_unknown', `snapshot version is "${String(snapshotRecord.version)}", expected "1.0"`, 'version');
  }

  const project = asRecord(snapshotRecord.project);
  if (!project) {
    error('project_missing', 'snapshot.project is required', 'project');
    return summarize(findings);
  }

  const metadata = asRecord(project.metadata);
  if (!metadata) {
    error('metadata_missing', 'project.metadata is required', 'project.metadata');
  } else {
    positiveInt(metadata.width, 'project.metadata.width', 'metadata_width_invalid', 'project width must be a positive integer');
    positiveInt(metadata.height, 'project.metadata.height', 'metadata_height_invalid', 'project height must be a positive integer');
    positiveInt(metadata.fps, 'project.metadata.fps', 'metadata_fps_invalid', 'project fps must be a positive integer');
  }

  if (!Array.isArray(snapshotRecord.mediaReferences)) {
    error('media_references_invalid', 'snapshot.mediaReferences must be an array', 'mediaReferences');
    return summarize(findings);
  }

  const mediaIds = validateMediaReferences(snapshotRecord.mediaReferences, push);
  const timeline = asRecord(project.timeline);
  if (!timeline) {
    warning('timeline_missing', 'project.timeline is missing; editor will open an empty timeline', 'project.timeline');
    return summarize(findings);
  }

  validateTimeline(timeline, { mediaIds, warnOnMissingMedia, error, warning });
  return summarize(findings);

  function positiveInt(value: unknown, path: string, code: string, message: string): void {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      error(code, `${message}, got ${String(value)}`, path);
    }
  }
}

export function lintSnapshot(snapshot: unknown, opts: SnapshotValidationOptions = {}): SnapshotValidationResult {
  return validateSnapshot(snapshot, opts);
}

function validateMediaReferences(mediaReferences: unknown[], push: PushFinding): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<string>();

  mediaReferences.forEach((entry: unknown, index: number) => {
    const path = `mediaReferences[${index}]`;
    const media = asRecord(entry);
    const id = stringValue(media?.id);
    if (!media || !id) {
      push({ severity: 'error', code: 'media_id_missing', message: 'media reference id is required', path });
      return;
    }
    if (seen.has(id)) {
      push({
        severity: 'error',
        code: 'duplicate_id',
        message: `duplicate media id "${id}"`,
        path: `${path}.id`,
        entityId: id,
      });
    }
    seen.add(id);
    ids.add(id);

    if (!media.fileName) {
      push({
        severity: 'error',
        code: 'media_file_name_missing',
        message: `media "${id}" is missing fileName`,
        path: `${path}.fileName`,
        entityId: id,
      });
    }
    const duration = numberValue(media.duration);
    if (duration !== null && duration < 0) {
      push({
        severity: 'error',
        code: 'media_duration_invalid',
        message: `media "${id}" duration must be non-negative`,
        path: `${path}.duration`,
        entityId: id,
      });
    }
  });

  return ids;
}

function validateTimeline(timeline: JsonRecord, ctx: ValidationContext): void {
  const tracks = recordsFromArray(timeline.tracks);
  const items = recordsFromArray(timeline.items);
  const transitions = recordsFromArray(timeline.transitions);
  const markers = recordsFromArray(timeline.markers);

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

  tracks.forEach((track: JsonRecord, index: number) => {
    const path = `project.timeline.tracks[${index}]`;
    checkId(track.id, path, allIds, ctx.error);
    const id = stringValue(track.id);
    if (id) trackIds.add(id);
    if (!track.name) ctx.warning('track_name_missing', `track "${id}" has no name`, `${path}.name`, id);
    if (!Number.isFinite(track.order)) {
      ctx.error('track_order_invalid', `track "${id}" order must be a number`, `${path}.order`, id);
    }
  });

  items.forEach((item: JsonRecord, index: number) => {
    const path = `project.timeline.items[${index}]`;
    checkId(item.id, path, allIds, ctx.error);
    const id = stringValue(item.id);
    if (id) itemIds.add(id);
    validateItem(item, path, trackIds, ctx);
  });

  transitions.forEach((transition: JsonRecord, index: number) => {
    const path = `project.timeline.transitions[${index}]`;
    checkId(transition.id, path, allIds, ctx.error);
    validateTransition(transition, path, itemIds, items, ctx);
  });

  markers.forEach((marker: JsonRecord, index: number) => {
    const path = `project.timeline.markers[${index}]`;
    checkId(marker.id, path, allIds, ctx.error);
    const id = stringValue(marker.id);
    const frame = numberValue(marker.frame);
    if (frame === null || !Number.isInteger(frame) || frame < 0) {
      ctx.error('marker_frame_invalid', `marker "${id}" frame must be a non-negative integer`, `${path}.frame`, id);
    }
  });

  validateInOutPoints(timeline, ctx);
}

function validateInOutPoints(timeline: JsonRecord, ctx: ValidationContext): void {
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
  const lastFrame = recordsFromArray(timeline.items).reduce(
    (max: number, item: JsonRecord) => Math.max(max, frameEnd(item)),
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

function validateItem(item: JsonRecord, path: string, trackIds: Set<string>, ctx: ValidationContext): void {
  const id = stringValue(item.id);
  const type = stringValue(item.type);
  const trackId = stringValue(item.trackId);
  const mediaId = stringValue(item.mediaId);

  if (!trackId || !trackIds.has(trackId)) {
    ctx.error('item_track_missing', `item "${id}" references missing track "${trackId}"`, `${path}.trackId`, id);
  }
  const from = numberValue(item.from);
  if (from === null || !Number.isInteger(from) || from < 0) {
    ctx.error('item_from_invalid', `item "${id}" from must be a non-negative integer`, `${path}.from`, id);
  }
  const durationInFrames = numberValue(item.durationInFrames);
  if (durationInFrames === null || !Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    ctx.error('item_duration_invalid', `item "${id}" durationInFrames must be a positive integer`, `${path}.durationInFrames`, id);
  }
  if (type && MEDIA_TYPES.has(type) && mediaId && ctx.warnOnMissingMedia && !ctx.mediaIds.has(mediaId)) {
    ctx.warning('item_media_missing', `item "${id}" references missing media "${mediaId}"`, `${path}.mediaId`, id);
  }
  if (type === 'text' && !item.text) {
    ctx.error('text_required', `text item "${id}" requires text`, `${path}.text`, id);
  }
  if (type === 'shape' && !item.shapeType) {
    ctx.error('shape_type_required', `shape item "${id}" requires shapeType`, `${path}.shapeType`, id);
  }
  if (type && SOURCE_TIMED_TYPES.has(type)) {
    validateSourceTiming(item, path, ctx);
  }
  const transform = asRecord(item.transform);
  const opacity = numberValue(transform?.opacity);
  if (opacity !== null && (opacity < 0 || opacity > 1)) {
    ctx.error('opacity_range', `item "${id}" opacity must be between 0 and 1`, `${path}.transform.opacity`, id);
  }
}

function validateSourceTiming(item: JsonRecord, path: string, ctx: ValidationContext): void {
  const id = stringValue(item.id);
  const sourceStart = numberValue(item.sourceStart);
  const sourceEnd = numberValue(item.sourceEnd);
  const speed = numberValue(item.speed);

  if (item.sourceStart !== undefined && (sourceStart === null || !Number.isInteger(sourceStart) || sourceStart < 0)) {
    ctx.error('source_start_invalid', `item "${id}" sourceStart must be a non-negative integer`, `${path}.sourceStart`, id);
  }
  if (item.sourceEnd !== undefined && (sourceEnd === null || !Number.isInteger(sourceEnd) || sourceEnd < 0)) {
    ctx.error('source_end_invalid', `item "${id}" sourceEnd must be a non-negative integer`, `${path}.sourceEnd`, id);
  }
  if (sourceStart !== null && sourceEnd !== null && sourceEnd < sourceStart) {
    ctx.error('source_range_invalid', `item "${id}" sourceEnd must be >= sourceStart`, `${path}.sourceEnd`, id);
  }
  if (item.speed !== undefined && (speed === null || speed <= 0)) {
    ctx.error('speed_invalid', `item "${id}" speed must be positive`, `${path}.speed`, id);
  }
}

function validateTransition(
  transition: JsonRecord,
  path: string,
  itemIds: Set<string>,
  items: JsonRecord[],
  ctx: ValidationContext,
): void {
  const id = stringValue(transition.id);
  const leftClipId = stringValue(transition.leftClipId);
  const rightClipId = stringValue(transition.rightClipId);
  const trackId = stringValue(transition.trackId);

  if (!leftClipId || !itemIds.has(leftClipId)) {
    ctx.error('transition_left_missing', `transition "${id}" references missing left clip`, `${path}.leftClipId`, id);
  }
  if (!rightClipId || !itemIds.has(rightClipId)) {
    ctx.error('transition_right_missing', `transition "${id}" references missing right clip`, `${path}.rightClipId`, id);
  }
  const durationInFrames = numberValue(transition.durationInFrames);
  if (durationInFrames === null || !Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    ctx.error('transition_duration_invalid', `transition "${id}" durationInFrames must be positive`, `${path}.durationInFrames`, id);
  }

  const left = items.find((item: JsonRecord) => item.id === leftClipId);
  const right = items.find((item: JsonRecord) => item.id === rightClipId);
  if (!left || !right) return;
  if (left.trackId !== right.trackId) {
    ctx.error('transition_track_mismatch', `transition "${id}" clips must be on the same track`, path, id);
  }
  if (trackId !== left.trackId) {
    ctx.error('transition_track_invalid', `transition "${id}" trackId does not match its clips`, `${path}.trackId`, id);
  }
  const leftEnd = frameEnd(left);
  const rightFrom = numberValue(right.from);
  if (rightFrom !== null && leftEnd !== rightFrom) {
    ctx.warning(
      'transition_not_adjacent',
      `transition "${id}" clips are not adjacent (${leftEnd} -> ${rightFrom})`,
      path,
      id,
    );
  }
}

function checkId(id: unknown, path: string, allIds: Set<string>, error: ReportFinding): void {
  if (!id) {
    error('id_missing', 'id is required', `${path}.id`);
    return;
  }
  const normalizedId = String(id);
  if (allIds.has(normalizedId)) {
    error('duplicate_id', `duplicate id "${normalizedId}"`, `${path}.id`, normalizedId);
  }
  allIds.add(normalizedId);
}

function summarize(findings: SnapshotFinding[]): SnapshotValidationResult {
  const errorCount = findings.filter((finding: SnapshotFinding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding: SnapshotFinding) => finding.severity === 'warning').length;
  const infoCount = findings.filter((finding: SnapshotFinding) => finding.severity === 'info').length;
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null;
}

function recordsFromArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is JsonRecord => entry !== null) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function frameEnd(item: JsonRecord): number {
  return Number(item.from ?? 0) + Number(item.durationInFrames ?? 0);
}
