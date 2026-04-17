/**
 * Pure path builders for the workspace filesystem layout.
 *
 * Every file in the workspace is derived from ids via these helpers so the
 * layout is in one place and easy to audit. Keep these as arrays of segments
 * — consumers compose them with FS primitives rather than string-joining,
 * because File System Access API uses nested getDirectoryHandle calls, not
 * slash-separated paths.
 *
 * Layout reference:
 * ```
 * {workspace}/
 * ├── README.md
 * ├── .freecut-workspace.json
 * ├── index.json
 * ├── projects/
 * │   └── {id}/
 * │       ├── project.json
 * │       ├── thumbnail.jpg
 * │       └── media-links.json
 * ├── media/
 * │   └── {id}/
 * │       ├── metadata.json
 * │       ├── source.{ext}  |  source.link.json
 * │       ├── thumbnail.jpg
 * │       └── cache/
 * │           ├── filmstrip/{meta.json,frame-N.jpg}
 * │           ├── waveform/{meta.json,bin-N.bin}
 * │           ├── gif-frames/{meta.json,frame-N.png}
 * │           ├── decoded-audio/{meta.json,left-N.bin,right-N.bin}
 * │           └── transcript.json
 * └── content/
 *     └── {hash[0:2]}/{hash}/
 *         ├── refs.json
 *         └── data.{ext}
 * ```
 */

export const WORKSPACE_SCHEMA_VERSION = '1.0';

export const README_FILENAME = 'README.md';
export const MARKER_FILENAME = '.freecut-workspace.json';
export const INDEX_FILENAME = 'index.json';

export const PROJECTS_DIR = 'projects';
export const MEDIA_DIR = 'media';
export const CONTENT_DIR = 'content';

export const PROJECT_FILENAME = 'project.json';
export const PROJECT_THUMBNAIL_FILENAME = 'thumbnail.jpg';
export const PROJECT_MEDIA_LINKS_FILENAME = 'media-links.json';

/**
 * Marker file present inside a project directory that has been soft-deleted.
 * Its presence hides the project from `getAllProjects()` / the index while
 * preserving all content for possible restore. A periodic sweep (see
 * `trash.ts`) permanently removes projects whose `deletedAt` is older than
 * the configured TTL.
 *
 * Naming choice: `.freecut-trashed.json` makes the state self-explanatory
 * when browsing the workspace folder externally with a file manager.
 */
export const PROJECT_TRASHED_MARKER_FILENAME = '.freecut-trashed.json';

export const MEDIA_METADATA_FILENAME = 'metadata.json';
export const MEDIA_THUMBNAIL_FILENAME = 'thumbnail.jpg';
export const MEDIA_SOURCE_LINK_FILENAME = 'source.link.json';
export const MEDIA_CACHE_DIR = 'cache';

export const CACHE_FILMSTRIP_DIR = 'filmstrip';
export const CACHE_WAVEFORM_DIR = 'waveform';
export const CACHE_GIF_FRAMES_DIR = 'gif-frames';
export const CACHE_DECODED_AUDIO_DIR = 'decoded-audio';
export const CACHE_TRANSCRIPT_FILENAME = 'transcript.json';
export const CACHE_META_FILENAME = 'meta.json';

export const CONTENT_REFS_FILENAME = 'refs.json';

/** Segments for `projects/{id}/`. */
export function projectDir(id: string): string[] {
  return [PROJECTS_DIR, id];
}

/** Segments for `projects/{id}/project.json`. */
export function projectJsonPath(id: string): string[] {
  return [...projectDir(id), PROJECT_FILENAME];
}

/** Segments for `projects/{id}/thumbnail.jpg`. */
export function projectThumbnailPath(id: string): string[] {
  return [...projectDir(id), PROJECT_THUMBNAIL_FILENAME];
}

/** Segments for `projects/{id}/media-links.json`. */
export function projectMediaLinksPath(id: string): string[] {
  return [...projectDir(id), PROJECT_MEDIA_LINKS_FILENAME];
}

/** Segments for `projects/{id}/.freecut-trashed.json`. */
export function projectTrashedMarkerPath(id: string): string[] {
  return [...projectDir(id), PROJECT_TRASHED_MARKER_FILENAME];
}

/** Segments for `media/{id}/`. */
export function mediaDir(id: string): string[] {
  return [MEDIA_DIR, id];
}

/** Segments for `media/{id}/metadata.json`. */
export function mediaMetadataPath(id: string): string[] {
  return [...mediaDir(id), MEDIA_METADATA_FILENAME];
}

/** Segments for `media/{id}/thumbnail.jpg`. */
export function mediaThumbnailPath(id: string): string[] {
  return [...mediaDir(id), MEDIA_THUMBNAIL_FILENAME];
}

/** Segments for the legacy `media/{id}/source.{ext}` layout. */
export function mediaSourcePath(id: string, extension: string): string[] {
  const ext = extension.startsWith('.') ? extension.slice(1) : extension;
  return [...mediaDir(id), `source.${ext}`];
}

/**
 * Segments for `media/{id}/{sanitizedName}` — preserves the user-visible
 * original filename inside the workspace folder so browsing on disk is
 * intelligible (`MyVacation.mp4` rather than `source.mp4`).
 */
export function mediaSourceByFileName(id: string, fileName: string): string[] {
  return [...mediaDir(id), sanitizeWorkspaceFileName(fileName)];
}

/** Never-allowed characters, per NTFS + ext4 intersection. */
// eslint-disable-next-line no-control-regex -- control chars are exactly what we want to strip
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

/** Names reserved by Windows; suffix with `_` to sidestep them. */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const MAX_FILENAME_LENGTH = 200;

/**
 * Produce a cross-filesystem-safe variant of a user-supplied filename.
 * Falls back to `source.bin` for empty / all-invalid inputs.
 */
export function sanitizeWorkspaceFileName(fileName: string): string {
  const trimmed = (fileName ?? '').replace(/^\s+|[\s.]+$/g, '');
  if (!trimmed) return 'source.bin';

  let cleaned = trimmed.replace(INVALID_FILENAME_CHARS, '_');

  // Extract the extension so truncation doesn't chop it off.
  const dot = cleaned.lastIndexOf('.');
  const hasExt = dot > 0 && dot < cleaned.length - 1;
  const stem = hasExt ? cleaned.slice(0, dot) : cleaned;
  const ext = hasExt ? cleaned.slice(dot) : '';

  const stemBudget = Math.max(1, MAX_FILENAME_LENGTH - ext.length);
  const bounded = stem.length > stemBudget ? stem.slice(0, stemBudget) : stem;

  // Windows reserved names are matched case-insensitively against the stem.
  const isReserved = WINDOWS_RESERVED_NAMES.has(bounded.toUpperCase());
  cleaned = `${isReserved ? `${bounded}_` : bounded}${ext}`;

  return cleaned || 'source.bin';
}

/** Segments for `media/{id}/source.link.json`. */
export function mediaSourceLinkPath(id: string): string[] {
  return [...mediaDir(id), MEDIA_SOURCE_LINK_FILENAME];
}

/** Segments for `media/{id}/cache/`. */
export function mediaCacheDir(id: string): string[] {
  return [...mediaDir(id), MEDIA_CACHE_DIR];
}

export function filmstripDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_FILMSTRIP_DIR];
}

export function filmstripFramePath(mediaId: string, frameIndex: number): string[] {
  return [...filmstripDir(mediaId), `frame-${frameIndex}.jpg`];
}

export function waveformDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_WAVEFORM_DIR];
}

export function waveformBinPath(mediaId: string, binIndex: number): string[] {
  return [...waveformDir(mediaId), `bin-${binIndex}.bin`];
}

export function gifFramesDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_GIF_FRAMES_DIR];
}

export function gifFramePath(mediaId: string, frameIndex: number): string[] {
  return [...gifFramesDir(mediaId), `frame-${frameIndex}.png`];
}

export function decodedAudioDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_DECODED_AUDIO_DIR];
}

export function decodedAudioBinPath(
  mediaId: string,
  channel: 'left' | 'right',
  binIndex: number,
): string[] {
  return [...decodedAudioDir(mediaId), `${channel}-${binIndex}.bin`];
}

export function transcriptPath(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_TRANSCRIPT_FILENAME];
}

export function cacheMetaPath(dir: string[]): string[] {
  return [...dir, CACHE_META_FILENAME];
}

/** Segments for `content/{hash[0:2]}/{hash}/`. Sharded by hash prefix. */
export function contentDir(hash: string): string[] {
  const shard = hash.slice(0, 2);
  return [CONTENT_DIR, shard, hash];
}

export function contentRefsPath(hash: string): string[] {
  return [...contentDir(hash), CONTENT_REFS_FILENAME];
}

export function contentDataPath(hash: string, extension: string): string[] {
  const ext = extension.startsWith('.') ? extension.slice(1) : extension;
  return [...contentDir(hash), `data.${ext}`];
}

/* ───────────────── Mirrored OPFS caches (shared across origins) ─────────────── */
//
// These caches are primary in OPFS for speed but are also mirrored into the
// workspace folder so other origins can read them without regenerating.

export const WORKSPACE_PROXIES_DIR = 'proxies';
export const WORKSPACE_FILMSTRIPS_DIR = 'filmstrips';
export const WORKSPACE_PREVIEW_AUDIO_DIR = 'preview-audio';
export const WORKSPACE_WAVEFORM_BIN_DIR = 'waveform-bin';

export function proxyFilePath(proxyKey: string): string[] {
  return [WORKSPACE_PROXIES_DIR, proxyKey, 'proxy.mp4'];
}

export function proxyMetaPath(proxyKey: string): string[] {
  return [WORKSPACE_PROXIES_DIR, proxyKey, 'meta.json'];
}

export function filmstripFileFramePath(mediaId: string, frameIndex: number, ext: string): string[] {
  return [WORKSPACE_FILMSTRIPS_DIR, mediaId, `${frameIndex}.${ext}`];
}

export function filmstripMetaPath(mediaId: string): string[] {
  return [WORKSPACE_FILMSTRIPS_DIR, mediaId, 'meta.json'];
}

export function previewAudioPath(relativePath: string): string[] {
  // relativePath like 'm-123/track-left.wav' — keep original OPFS layout.
  return [WORKSPACE_PREVIEW_AUDIO_DIR, ...relativePath.split('/')];
}

/**
 * Fast multi-resolution waveform binary — the OPFS-primary cache used by the
 * timeline renderer, mirrored here for cross-origin reuse. Different from
 * `waveformBinPath` above, which addresses bins inside the per-media cache.
 */
export function waveformBinaryPath(mediaId: string): string[] {
  return [WORKSPACE_WAVEFORM_BIN_DIR, `${mediaId}.bin`];
}
