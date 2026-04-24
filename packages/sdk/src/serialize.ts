/**
 * Snapshot serialization. Produces the same `ProjectSnapshot` JSON shape
 * that the FreeCut editor's JSON import service consumes, so a file
 * written by `serialize()` can be opened directly in the app.
 */

import {
  SnapshotParseError,
  parseSnapshot,
  serializeSnapshot,
  toSnapshot as coreToSnapshot,
} from '@freecut/core';
import type { SnapshotOptions, SnapshotSource } from '@freecut/core';
import type { MediaReference, Project, ProjectSnapshot } from './types.js';
import { SDK_VERSION } from './types.js';
import { ProjectBuilder } from './builder.js';

type SdkSnapshotSource = SnapshotSource<Project, MediaReference>;

export interface SerializeOptions extends Omit<SnapshotOptions<MediaReference>, 'mediaReferences'> {
  /** Pretty-print JSON output (default: true). */
  pretty?: boolean;
  /** ISO timestamp to embed as `exportedAt` — defaults to now. */
  exportedAt?: string;
  /** Override the editor version string embedded in the snapshot. */
  editorVersion?: string;
  /** Extra media references to merge in alongside any registered via the builder. */
  mediaReferences?: MediaReference[];
}

export { SnapshotParseError };

export function toSnapshot(
  source: Project | ProjectBuilder,
  opts: SerializeOptions = {},
): ProjectSnapshot {
  return coreToSnapshot<Project, MediaReference>(normalizeSnapshotSource(source), {
    ...opts,
    editorVersion: opts.editorVersion ?? `@freecut/sdk@${SDK_VERSION}`,
  });
}

export function serialize(
  source: Project | ProjectBuilder,
  opts: SerializeOptions = {},
): string {
  return serializeSnapshot<Project, MediaReference>(normalizeSnapshotSource(source), {
    ...opts,
    editorVersion: opts.editorVersion ?? `@freecut/sdk@${SDK_VERSION}`,
  });
}

/**
 * Parse a snapshot JSON string back into a `ProjectSnapshot`. Does
 * light structural checks — full schema validation lives in validation.
 */
export function parse(json: string): ProjectSnapshot {
  return parseSnapshot<Project, MediaReference>(json);
}

function normalizeSnapshotSource(source: Project | ProjectBuilder): SdkSnapshotSource {
  if (source instanceof ProjectBuilder) {
    return {
      project: source.project,
      mediaReferences: source.mediaReferences,
    };
  }
  return {
    project: source,
    mediaReferences: [],
  };
}
