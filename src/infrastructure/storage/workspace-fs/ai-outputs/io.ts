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
  return readAiOutputAt(aiOutputPath(mediaId, kind), kind, `readAiOutput(${mediaId}, ${kind})`);
}

/**
 * Read an AI output envelope from an arbitrary workspace path. Used by the
 * content-keyed caption cache where the envelope lives under
 * `content/{shard}/{hash}/ai/` rather than `media/{id}/cache/ai/`.
 */
export async function readAiOutputAt<K extends AiOutputKind>(
  segments: string[],
  kind: K,
  context = `readAiOutputAt(${segments.join('/')}, ${kind})`,
): Promise<AiOutput<K> | undefined> {
  const root = requireWorkspaceRoot();
  try {
    const result = await readJson<AiOutput<K>>(root, segments);
    return result ?? undefined;
  } catch (error) {
    logger.error(`${context} failed`, error);
    throw new Error(`Failed to load AI output ${kind}`);
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
  return writeAiOutputAt(aiOutputPath(input.mediaId, input.kind), input);
}

/**
 * Same as {@link writeAiOutput} but at an explicit path. The envelope still
 * records `mediaId` from the input for provenance — for the content-keyed
 * cache, this is the mediaId of the run that populated the cache first.
 */
export async function writeAiOutputAt<K extends AiOutputKind>(
  segments: string[],
  input: WriteInput<K>,
): Promise<AiOutput<K>> {
  const root = requireWorkspaceRoot();
  const now = Date.now();
  const existing = await readJson<AiOutput<K>>(root, segments);

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
    await writeJsonAtomic(root, segments, envelope);
    return envelope;
  } catch (error) {
    logger.error(`writeAiOutputAt(${segments.join('/')}, ${input.kind}) failed`, error);
    throw new Error(`Failed to save AI output ${input.kind}`);
  }
}

export async function deleteAiOutput(
  mediaId: string,
  kind: AiOutputKind,
): Promise<void> {
  return deleteAiOutputAt(aiOutputPath(mediaId, kind), `deleteAiOutput(${mediaId}, ${kind})`);
}

export async function deleteAiOutputAt(
  segments: string[],
  context = `deleteAiOutputAt(${segments.join('/')})`,
): Promise<void> {
  const root = requireWorkspaceRoot();
  try {
    await removeEntry(root, segments);
  } catch (error) {
    logger.error(`${context} failed`, error);
    throw new Error(`Failed to delete AI output`);
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
