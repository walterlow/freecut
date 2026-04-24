export const SNAPSHOT_VERSION = '1.0';
export const CORE_VERSION = '0.0.1';

export class SnapshotParseError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'SnapshotParseError';
    this.cause = cause;
  }
}

export function toSnapshot(source, opts = {}) {
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

export function serializeSnapshot(source, opts = {}) {
  const snapshot = toSnapshot(source, opts);
  return opts.pretty === false
    ? JSON.stringify(snapshot)
    : JSON.stringify(snapshot, null, 2);
}

export function parseSnapshot(json) {
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

function extractProject(source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('snapshot source must be a project or object with a project property');
  }
  if (source.project && typeof source.project === 'object') return source.project;
  return source;
}
