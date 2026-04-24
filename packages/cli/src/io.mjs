/**
 * Snapshot file I/O. Reads/writes `.fcproject` JSON atomically: writes
 * to `<file>.tmp` then renames, so a crash mid-write can't corrupt the
 * project.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseSnapshot } from '@freecut/core';

export async function readSnapshot(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return parseSnapshot(raw);
}

export async function writeSnapshot(filePath, snapshot) {
  const tmp = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
  await rename(tmp, filePath);
}
