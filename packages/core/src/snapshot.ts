export const SNAPSHOT_VERSION = '1.0';
export const CORE_VERSION = '0.0.1';

export class SnapshotParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SnapshotParseError';
    this.cause = cause;
  }
}

export interface ProjectMetadataLike {
  width?: number;
  height?: number;
  fps?: number;
  backgroundColor?: string;
}

export interface ProjectTimelineLike {
  tracks?: unknown[];
  items?: unknown[];
  transitions?: unknown[];
  markers?: unknown[];
  currentFrame?: number;
  inPoint?: number;
  outPoint?: number;
}

export interface ProjectLike {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
  duration?: number;
  schemaVersion?: number;
  metadata?: ProjectMetadataLike;
  timeline?: ProjectTimelineLike;
}

export interface MediaReferenceLike {
  id?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  contentHash?: string;
}

export interface ProjectSnapshot<
  TProject extends object = ProjectLike,
  TMediaReference = MediaReferenceLike,
> {
  version: string;
  exportedAt: string;
  editorVersion: string;
  project: TProject;
  mediaReferences: TMediaReference[];
  checksum?: string;
}

export type SnapshotLike = ProjectSnapshot<object, unknown>;

export interface SnapshotEnvelope<
  TProject extends object = object,
  TMediaReference = unknown,
> {
  project: TProject;
  mediaReferences?: TMediaReference[];
}

export type SnapshotSource<
  TProject extends object = object,
  TMediaReference = unknown,
> = TProject | SnapshotEnvelope<TProject, TMediaReference>;

export interface SnapshotOptions<TMediaReference = unknown> {
  version?: string;
  exportedAt?: string;
  editorVersion?: string;
  mediaReferences?: TMediaReference[];
  pretty?: boolean;
}

export function toSnapshot<
  TProject extends object = object,
  TMediaReference = unknown,
>(
  source: SnapshotSource<TProject, TMediaReference>,
  opts: SnapshotOptions<TMediaReference> = {},
): ProjectSnapshot<TProject, TMediaReference> {
  const envelope = asSnapshotEnvelope(source);
  const project = extractProject(source, envelope);
  const sourceRefs = envelope && Array.isArray(envelope.mediaReferences) ? envelope.mediaReferences : [];
  const mediaReferences = [...sourceRefs, ...(opts.mediaReferences ?? [])];

  return {
    version: opts.version ?? SNAPSHOT_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    editorVersion: opts.editorVersion ?? `@freecut/core@${CORE_VERSION}`,
    project,
    mediaReferences,
  };
}

export function serializeSnapshot<
  TProject extends object = object,
  TMediaReference = unknown,
>(
  source: SnapshotSource<TProject, TMediaReference>,
  opts: SnapshotOptions<TMediaReference> = {},
): string {
  const snapshot = toSnapshot(source, opts);
  return opts.pretty === false
    ? JSON.stringify(snapshot)
    : JSON.stringify(snapshot, null, 2);
}

export function parseSnapshot<
  TProject extends object = object,
  TMediaReference = unknown,
>(json: string): ProjectSnapshot<TProject, TMediaReference> {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new SnapshotParseError('invalid JSON', err);
  }

  if (!raw || typeof raw !== 'object') {
    throw new SnapshotParseError('snapshot must be a JSON object');
  }

  if (typeof raw.version !== 'string') {
    throw new SnapshotParseError('snapshot.version is required');
  }
  if (!raw.project || typeof raw.project !== 'object') {
    throw new SnapshotParseError('snapshot.project is required');
  }
  if (!Array.isArray(raw.mediaReferences)) {
    throw new SnapshotParseError('snapshot.mediaReferences must be an array');
  }

  return raw as ProjectSnapshot<TProject, TMediaReference>;
}

function extractProject<TProject extends object, TMediaReference>(
  source: SnapshotSource<TProject, TMediaReference>,
  envelope: SnapshotEnvelope<TProject, TMediaReference> | null,
): TProject {
  if (!source || typeof source !== 'object') {
    throw new TypeError('snapshot source must be a project or object with a project property');
  }
  if (envelope) return envelope.project;
  return source as TProject;
}

function asSnapshotEnvelope<TProject extends object, TMediaReference>(
  source: SnapshotSource<TProject, TMediaReference>,
): SnapshotEnvelope<TProject, TMediaReference> | null {
  if (!source || typeof source !== 'object' || !('project' in source)) return null;
  const project = (source as { project?: unknown }).project;
  return project && typeof project === 'object'
    ? source as SnapshotEnvelope<TProject, TMediaReference>
    : null;
}
