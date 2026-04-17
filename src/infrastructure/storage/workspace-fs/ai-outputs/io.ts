/**
 * Generic CRUD for AI output envelopes under `media/{id}/cache/ai/{kind}.json`.
 *
 * Every per-kind wrapper (transcripts, captions, scenes…) delegates here so
 * the on-disk layout, envelope shape, and error handling stay uniform.
 */

import { createLogger } from '@/shared/logging/logger';

import { requireWorkspaceRoot } from '../root';
import {
  readJson,
  removeEntry,
  writeJsonAtomic,
  listDirectory,
} from '../fs-primitives';
import { aiOutputPath, aiOutputsDir } from '../paths';

import {
  AI_OUTPUT_SCHEMA_VERSION,
  type AiOutput,
  type AiOutputKind,
  type AiOutputPayloads,
} from './types';

const logger = createLogger('WorkspaceFS:AiOutputs');

export async function readAiOutput<K extends AiOutputKind>(
  mediaId: string,
  kind: K,
): Promise<AiOutput<K> | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const result = await readJson<AiOutput<K>>(root, aiOutputPath(mediaId, kind));
    return result ?? undefined;
  } catch (error) {
    logger.error(`readAiOutput(${mediaId}, ${kind}) failed`, error);
    throw new Error(`Failed to load AI output ${kind} for ${mediaId}`);
  }
}

interface WriteInput<K extends AiOutputKind> {
  mediaId: string;
  kind: K;
  service: string;
  model: string;
  params?: Record<string, unknown>;
  data: AiOutputPayloads[K];
}

/**
 * Write an envelope atomically. Sets `createdAt` on first write and updates
 * `updatedAt` every time. Returns the persisted envelope.
 */
export async function writeAiOutput<K extends AiOutputKind>(
  input: WriteInput<K>,
): Promise<AiOutput<K>> {
  const root = requireWorkspaceRoot();
  const now = Date.now();
  const existing = await readJson<AiOutput<K>>(root, aiOutputPath(input.mediaId, input.kind));

  const envelope: AiOutput<K> = {
    schemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    kind: input.kind,
    mediaId: input.mediaId,
    service: input.service,
    model: input.model,
    params: input.params ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    data: input.data,
  };

  try {
    await writeJsonAtomic(root, aiOutputPath(input.mediaId, input.kind), envelope);
    return envelope;
  } catch (error) {
    logger.error(`writeAiOutput(${input.mediaId}, ${input.kind}) failed`, error);
    throw new Error(`Failed to save AI output ${input.kind} for ${input.mediaId}`);
  }
}

export async function deleteAiOutput(
  mediaId: string,
  kind: AiOutputKind,
): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, aiOutputPath(mediaId, kind));
  } catch (error) {
    logger.error(`deleteAiOutput(${mediaId}, ${kind}) failed`, error);
    throw new Error(`Failed to delete AI output ${kind} for ${mediaId}`);
  }
}

/**
 * List every AI output kind present for `mediaId`. Returns the `kind` stems
 * (no extension). Used by cleanup sweeps and debug UIs.
 */
export async function listAiOutputs(mediaId: string): Promise<AiOutputKind[]> {
  const root = requireWorkspaceRoot();
  try {
    const entries = await listDirectory(root, aiOutputsDir(mediaId));
    return entries
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length) as AiOutputKind);
  } catch (error) {
    logger.warn(`listAiOutputs(${mediaId}) failed`, error);
    return [];
  }
}

/**
 * Bulk existence probe. Returns the subset of `mediaIds` that have a saved
 * output of `kind`. Concurrent reads — callers should pre-batch by kind.
 */
export async function getMediaIdsWithAiOutput(
  mediaIds: string[],
  kind: AiOutputKind,
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const root = requireWorkspaceRoot();
  const ready = new Set<string>();
  const results = await Promise.all(
    mediaIds.map(async (id) => {
      const env = await readJson<AiOutput<typeof kind>>(root, aiOutputPath(id, kind));
      return env ? id : null;
    }),
  );
  for (const id of results) {
    if (id) ready.add(id);
  }
  return ready;
}
