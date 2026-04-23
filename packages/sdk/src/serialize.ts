/**
 * Snapshot serialization. Produces the same `ProjectSnapshot` JSON shape
 * that the FreeCut editor's JSON import service consumes, so a file
 * written by `serialize()` can be opened directly in the app.
 */

import type { MediaReference, Project, ProjectSnapshot } from './types.js';
import { SDK_VERSION, SNAPSHOT_VERSION } from './types.js';
import { ProjectBuilder } from './builder.js';

export interface SerializeOptions {
  /** Pretty-print JSON output (default: true). */
  pretty?: boolean;
  /** ISO timestamp to embed as `exportedAt` — defaults to now. */
  exportedAt?: string;
  /** Override the editor version string embedded in the snapshot. */
  editorVersion?: string;
  /** Extra media references to merge in alongside any registered via the builder. */
  mediaReferences?: MediaReference[];
}

export function toSnapshot(
  source: Project | ProjectBuilder,
  opts: SerializeOptions = {},
): ProjectSnapshot {
  const project = source instanceof ProjectBuilder ? source.project : source;
  const builderRefs = source instanceof ProjectBuilder ? source.mediaReferences : [];
  const mediaReferences = [...builderRefs, ...(opts.mediaReferences ?? [])];

  return {
    version: SNAPSHOT_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    editorVersion: opts.editorVersion ?? `@freecut/sdk@${SDK_VERSION}`,
    project,
    mediaReferences,
  };
}

export function serialize(
  source: Project | ProjectBuilder,
  opts: SerializeOptions = {},
): string {
  const snapshot = toSnapshot(source, opts);
  return opts.pretty === false
    ? JSON.stringify(snapshot)
    : JSON.stringify(snapshot, null, 2);
}

export class SnapshotParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SnapshotParseError';
  }
}

/**
 * Parse a snapshot JSON string back into a `ProjectSnapshot`. Does
 * light structural checks — full zod validation lives in the app.
 */
export function parse(json: string): ProjectSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new SnapshotParseError('invalid JSON', err);
  }

  if (!raw || typeof raw !== 'object') {
    throw new SnapshotParseError('snapshot must be a JSON object');
  }

  const candidate = raw as Partial<ProjectSnapshot>;
  if (typeof candidate.version !== 'string') {
    throw new SnapshotParseError('snapshot.version is required');
  }
  if (!candidate.project || typeof candidate.project !== 'object') {
    throw new SnapshotParseError('snapshot.project is required');
  }
  if (!Array.isArray(candidate.mediaReferences)) {
    throw new SnapshotParseError('snapshot.mediaReferences must be an array');
  }

  return candidate as ProjectSnapshot;
}
