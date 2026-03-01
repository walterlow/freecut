import { opfsService } from '@/features/effects/deps/media-library-contract';

export interface SavedCubeLut {
  id: string;
  name: string;
  opfsPath: string;
  dataHash: string;
  createdAt: number;
  updatedAt: number;
}

const LUT_LIBRARY_DIR = 'luts';
const LUT_LIBRARY_MANIFEST_PATH = `${LUT_LIBRARY_DIR}/manifest.json`;
const MAX_SAVED_LUTS = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Custom LUT';
  return trimmed;
}

function now(): number {
  return Date.now();
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'NotFoundError'
    || error.message.includes('File not found')
  );
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function serializeManifest(luts: SavedCubeLut[]): ArrayBuffer {
  const bytes = textEncoder.encode(JSON.stringify(luts));
  return toArrayBuffer(bytes);
}

function parseSavedCubeLut(entry: unknown): SavedCubeLut | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Record<string, unknown>;

  if (
    typeof candidate.id !== 'string'
    || typeof candidate.name !== 'string'
    || typeof candidate.opfsPath !== 'string'
    || typeof candidate.dataHash !== 'string'
    || typeof candidate.createdAt !== 'number'
    || typeof candidate.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    opfsPath: candidate.opfsPath,
    dataHash: candidate.dataHash,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

async function writeManifest(luts: SavedCubeLut[]): Promise<void> {
  const sorted = [...luts]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_LUTS);
  await opfsService.saveFile(LUT_LIBRARY_MANIFEST_PATH, serializeManifest(sorted));
}

async function readManifest(): Promise<SavedCubeLut[]> {
  try {
    const buffer = await opfsService.getFile(LUT_LIBRARY_MANIFEST_PATH);
    const raw = textDecoder.decode(buffer);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(parseSavedCubeLut)
      .filter((entry): entry is SavedCubeLut => entry !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SAVED_LUTS);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    return [];
  }
}

function makeLutPath(id: string): string {
  return `${LUT_LIBRARY_DIR}/${id}.cube`;
}

function randomLutId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function hashString(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function saveCubeToPath(path: string, cubeData: string): Promise<void> {
  const bytes = textEncoder.encode(cubeData);
  await opfsService.saveFile(path, toArrayBuffer(bytes));
}

async function removeLutFiles(luts: SavedCubeLut[]): Promise<void> {
  await Promise.all(
    luts.map(async (entry) => {
      try {
        await opfsService.deleteFile(entry.opfsPath);
      } catch {
        // No-op for cleanup best effort.
      }
    })
  );
}

export async function loadSavedCubeLuts(): Promise<SavedCubeLut[]> {
  return readManifest();
}

export async function saveCubeLutToLibrary(
  name: string,
  cubeData: string
): Promise<{
  luts: SavedCubeLut[];
  saved: SavedCubeLut | null;
  error: string | null;
}> {
  const normalizedName = normalizeName(name);
  const normalizedData = cubeData.trim();
  const current = await readManifest();

  if (!normalizedData) {
    return { luts: current, saved: null, error: 'LUT data is empty.' };
  }

  try {
    const dataHash = await hashString(normalizedData);
    const timestamp = now();
    const existingByHash = current.find((entry) => entry.dataHash === dataHash);

    const saved: SavedCubeLut = existingByHash
      ? {
          ...existingByHash,
          name: normalizedName,
          updatedAt: timestamp,
        }
      : (() => {
          const id = randomLutId();
          return {
            id,
            name: normalizedName,
            opfsPath: makeLutPath(id),
            dataHash,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        })();

    await saveCubeToPath(saved.opfsPath, normalizedData);

    const next = [
      saved,
      ...current.filter((entry) => entry.id !== saved.id),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const trimmed = next.slice(0, MAX_SAVED_LUTS);
    const evicted = next.slice(MAX_SAVED_LUTS);
    await writeManifest(trimmed);
    if (evicted.length > 0) {
      void removeLutFiles(evicted);
    }

    return { luts: trimmed, saved, error: null };
  } catch {
    return {
      luts: current,
      saved: null,
      error: 'Could not save LUT to OPFS. Your LUT was applied, but not stored.',
    };
  }
}

export async function loadCubeLutFromLibrary(
  id: string
): Promise<{ lut: SavedCubeLut; cubeData: string } | null> {
  const manifest = await readManifest();
  const lut = manifest.find((entry) => entry.id === id);
  if (!lut) return null;

  try {
    const buffer = await opfsService.getFile(lut.opfsPath);
    const cubeData = textDecoder.decode(buffer).trim();
    if (!cubeData) return null;
    return { lut, cubeData };
  } catch (error) {
    if (!isNotFoundError(error)) return null;

    const next = manifest.filter((entry) => entry.id !== id);
    await writeManifest(next);
    return null;
  }
}

export async function deleteCubeLutFromLibrary(
  id: string
): Promise<{ luts: SavedCubeLut[]; error: string | null }> {
  const manifest = await readManifest();
  const target = manifest.find((entry) => entry.id === id);
  if (!target) {
    return { luts: manifest, error: null };
  }

  const next = manifest.filter((entry) => entry.id !== id);

  try {
    await writeManifest(next);
  } catch {
    return { luts: manifest, error: 'Could not update LUT library manifest.' };
  }

  try {
    await opfsService.deleteFile(target.opfsPath);
  } catch {
    // File cleanup is best effort; manifest is authoritative.
  }

  return { luts: next, error: null };
}
