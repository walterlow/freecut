export const SNAPSHOT_VERSION = '1.0';
export const CORE_VERSION = '0.0.1';

export class SnapshotParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SnapshotParseError';
    this.cause = cause;
  }
}

export interface SnapshotLike {
  version: string;
  exportedAt: string;
  editorVersion: string;
  project: object;
  mediaReferences: unknown[];
}

export interface SnapshotSource {
  project?: object;
  mediaReferences?: unknown[];
  [key: string]: unknown;
}

export interface SnapshotOptions {
  version?: string;
  exportedAt?: string;
  editorVersion?: string;
  mediaReferences?: unknown[];
  pretty?: boolean;
}

export function toSnapshot(source: SnapshotSource, opts: SnapshotOptions = {}): SnapshotLike {
  const project = extractProject(source);
  const sourceRefs = Array.isArray(source?.mediaReferences) ? source.mediaReferences : [];
  const mediaReferences = [...sourceRefs, ...(opts.mediaReferences ?? [])];

  return {
    version: opts.version ?? SNAPSHOT_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    editorVersion: opts.editorVersion ?? `@freecut/core@${CORE_VERSION}`,
    project,
    mediaReferences,
  };
}

export function serializeSnapshot(source: SnapshotSource, opts: SnapshotOptions = {}): string {
  const snapshot = toSnapshot(source, opts);
  return opts.pretty === false
    ? JSON.stringify(snapshot)
    : JSON.stringify(snapshot, null, 2);
}

export function parseSnapshot(json: string): SnapshotLike {
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

  return raw;
}

function extractProject(source: SnapshotSource): object {
  if (!source || typeof source !== 'object') {
    throw new TypeError('snapshot source must be a project or object with a project property');
  }
  if (source.project && typeof source.project === 'object') return source.project;
  return source;
}
