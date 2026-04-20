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
 * │       ├── thumbnail.jpg          # project cover
 * │       └── media-links.json
 * ├── media/
 * │   └── {id}/
 * │       ├── metadata.json
 * │       ├── {sanitized-name}.{ext}  |  source.link.json
 * │       ├── thumbnail.jpg
 * │       └── cache/
 * │           ├── filmstrip/{meta.json,N.jpg}
 * │           ├── waveform/{meta.json,bin-N.bin,multi-res.bin}
 * │           ├── gif-frames/{meta.json,frame-N.png}
 * │           ├── decoded-audio/{meta.json,left-N.bin,right-N.bin}
 * │           ├── preview-audio.wav
 * │           └── ai/
 * │               ├── transcript.json
 * │               ├── captions.json
 * │               ├── scenes.json
 * │               └── {kind}.json          # new AI outputs go here, one file per kind
 * └── content/
 *     ├── {hash[0:2]}/{hash}/            # content-addressable source dedup (reserved)
 *     │   ├── refs.json
 *     │   └── data.{ext}
 *     └── proxies/{proxyKey}/            # shared proxies (keyed by content fingerprint)
 *         ├── proxy.mp4
 *         └── meta.json
 * ```
 *
 * Schema versions:
 * - 1.0: filmstrips/waveform-bin/preview-audio/proxies lived at the workspace
 *        root; project thumbnails were stored under media/<projectId>/.
 *        `thumbnail.meta.json` sidecar next to every media thumbnail.
 * - 2.0: per-media caches unified under `media/<id>/cache/`, proxies moved
 *        to `content/proxies/`, project thumbnails fixed to `projects/<id>/`,
 *        thumbnail.meta.json sidecar dropped.
 */

export const WORKSPACE_SCHEMA_VERSION = '2.0';

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

export const CACHE_WAVEFORM_DIR = 'waveform';
export const CACHE_FILMSTRIP_DIR = 'filmstrip';
export const CACHE_GIF_FRAMES_DIR = 'gif-frames';
export const CACHE_DECODED_AUDIO_DIR = 'decoded-audio';
export const CACHE_AI_DIR = 'ai';
/** Single file per media under cache/. Non-browser audio codecs are decoded
 *  once to WAV and reused for preview playback. */
export const CACHE_PREVIEW_AUDIO_FILENAME = 'preview-audio.wav';
/** Single file per media under cache/waveform/. Header-indexed multi-res
 *  binary format for timeline waveform rendering. */
export const CACHE_WAVEFORM_MULTI_RES_FILENAME = 'multi-res.bin';
/** Per-caption thumbnail JPEGs captured alongside LFM caption generation. */
export const CACHE_CAPTION_THUMBS_DIR = 'captions-thumbs';
/**
 * Legacy path for transcripts — was `cache/transcript.json` before AI outputs
 * were consolidated under `cache/ai/`. Readers fall back to this on miss; a
 * subsequent save rewrites to the new path.
 */
export const CACHE_TRANSCRIPT_FILENAME_LEGACY = 'transcript.json';
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

export function waveformDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_WAVEFORM_DIR];
}

export function waveformBinPath(mediaId: string, binIndex: number): string[] {
  return [...waveformDir(mediaId), `bin-${binIndex}.bin`];
}

/** Segments for `media/{id}/cache/waveform/multi-res.bin` — the header-indexed
 *  binary used by the timeline waveform renderer. Separate from the chunked
 *  `bin-{N}.bin` format which is produced by the decoded-audio pipeline. */
export function waveformMultiResPath(mediaId: string): string[] {
  return [...waveformDir(mediaId), CACHE_WAVEFORM_MULTI_RES_FILENAME];
}

/** Segments for `media/{id}/cache/filmstrip/`. */
export function filmstripDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_FILMSTRIP_DIR];
}

/** Segments for `media/{id}/cache/filmstrip/{N}.{ext}` — one frame per second. */
export function filmstripFramePath(mediaId: string, frameIndex: number, ext: string): string[] {
  return [...filmstripDir(mediaId), `${frameIndex}.${ext}`];
}

/** Segments for `media/{id}/cache/filmstrip/meta.json`. */
export function filmstripMetaPath(mediaId: string): string[] {
  return [...filmstripDir(mediaId), CACHE_META_FILENAME];
}

/** Segments for `media/{id}/cache/preview-audio.wav` — conformed preview
 *  audio for non-browser-native codecs. One WAV per media. */
export function previewAudioPath(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_PREVIEW_AUDIO_FILENAME];
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

/**
 * Segments for `media/{id}/cache/ai/` — home for AI-derived analysis outputs
 * (transcripts, captions, scene cuts, etc.). One file per `AiOutputKind`.
 */
export function aiOutputsDir(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_AI_DIR];
}

/**
 * Segments for `media/{id}/cache/ai/{kind}.json`. The caller owns the `kind`
 * enum (see `ai-outputs/types.ts`) — this helper only does path assembly.
 */
export function aiOutputPath(mediaId: string, kind: string): string[] {
  return [...aiOutputsDir(mediaId), `${kind}.json`];
}

/** Segments for `media/{id}/cache/ai/captions-thumbs/`. */
export function captionThumbsDir(mediaId: string): string[] {
  return [...aiOutputsDir(mediaId), CACHE_CAPTION_THUMBS_DIR];
}

/** Segments for `media/{id}/cache/ai/captions-thumbs/{index}.jpg`. */
export function captionThumbPath(mediaId: string, index: number): string[] {
  return [...captionThumbsDir(mediaId), `${index}.jpg`];
}

/**
 * Segments for `media/{id}/cache/ai/captions-embeddings.bin`. Stored as a
 * contiguous `Float32Array` so 384-dim * N-caption embeddings stay compact
 * (e.g. 500 captions = 750 KB vs ~4 MB if round-tripped through JSON).
 */
export function captionEmbeddingsPath(mediaId: string): string[] {
  return [...aiOutputsDir(mediaId), 'captions-embeddings.bin'];
}

/**
 * Segments for `media/{id}/cache/ai/captions-image-embeddings.bin`. Same
 * packing as the text embeddings bin but in the CLIP joint embedding
 * space (typically 512-dim), so semantic queries can fall back to
 * matching on what the clip *looks like* when caption text is thin.
 */
export function captionImageEmbeddingsPath(mediaId: string): string[] {
  return [...aiOutputsDir(mediaId), 'captions-image-embeddings.bin'];
}

/**
 * Workspace-root-relative path (forward-slash separated) for a caption thumb,
 * safe to persist in JSON / `MediaCaption.thumbRelPath`.
 */
export function captionThumbRelPath(mediaId: string, index: number): string {
  return captionThumbPath(mediaId, index).join('/');
}

/* ---------------- Content-keyed caption storage (shared cache) ---------------- */
//
// Captions are a pure function of source bytes plus the analysis parameters
// that affect output cardinality (today: sampleIntervalSec). When contentHash
// is known, the envelope, packed embedding bins, and per-scene thumbnail JPEGs
// live in the content-addressable tree and are shared across every mediaId
// that resolves to the same hash AND caption-cache variant. Reference counts
// for this cache live in a sibling `refs.json` and are independent of the
// source-blob `refs.json` — media items using `handle` storage dedup their
// captions even though their source bytes never land in `content/{hash}/data.{ext}`.

export function contentAiDir(hash: string): string[] {
  return [...contentDir(hash), CACHE_AI_DIR];
}

/**
 * Shared caption cache variant key. Rounded to centiseconds so values that
 * differ only by tiny float noise still resolve to the same on-disk cache.
 * Returns null for legacy/unversioned cache records.
 */
export function contentCaptionCacheVariantKey(sampleIntervalSec?: number): string | null {
  if (
    sampleIntervalSec === undefined
    || !Number.isFinite(sampleIntervalSec)
    || sampleIntervalSec <= 0
  ) {
    return null;
  }
  return `si-${Math.round(sampleIntervalSec * 100)}`;
}

/**
 * Segments for the shared caption cache root. Legacy caches live directly
 * under `content/{hash}/ai/`; interval-versioned caches live under
 * `content/{hash}/ai/{variantKey}/`.
 */
export function contentCaptionCacheDir(hash: string, sampleIntervalSec?: number): string[] {
  const variantKey = contentCaptionCacheVariantKey(sampleIntervalSec);
  return variantKey ? [...contentAiDir(hash), variantKey] : contentAiDir(hash);
}

export function contentAiRefsPath(hash: string, sampleIntervalSec?: number): string[] {
  return [...contentCaptionCacheDir(hash, sampleIntervalSec), CONTENT_REFS_FILENAME];
}

export function contentCaptionsJsonPath(hash: string, sampleIntervalSec?: number): string[] {
  return [...contentCaptionCacheDir(hash, sampleIntervalSec), 'captions.json'];
}

export function contentCaptionEmbeddingsPath(hash: string, sampleIntervalSec?: number): string[] {
  return [...contentCaptionCacheDir(hash, sampleIntervalSec), 'captions-embeddings.bin'];
}

export function contentCaptionImageEmbeddingsPath(hash: string, sampleIntervalSec?: number): string[] {
  return [...contentCaptionCacheDir(hash, sampleIntervalSec), 'captions-image-embeddings.bin'];
}

export function contentCaptionThumbsDir(hash: string, sampleIntervalSec?: number): string[] {
  return [...contentCaptionCacheDir(hash, sampleIntervalSec), CACHE_CAPTION_THUMBS_DIR];
}

export function contentCaptionThumbPath(
  hash: string,
  index: number,
  sampleIntervalSec?: number,
): string[] {
  return [...contentCaptionThumbsDir(hash, sampleIntervalSec), `${index}.jpg`];
}

/**
 * Workspace-root-relative path for a content-keyed caption thumbnail. Stored
 * on `MediaCaption.thumbRelPath` when captions are shared — different mediaIds
 * sharing a hash all resolve their thumbs through this path.
 */
export function contentCaptionThumbRelPath(
  hash: string,
  index: number,
  sampleIntervalSec?: number,
): string {
  return contentCaptionThumbPath(hash, index, sampleIntervalSec).join('/');
}

/**
 * Legacy path kept only for read-fallback. New writes go through
 * `aiOutputPath(mediaId, 'transcript')`.
 */
export function legacyTranscriptPath(mediaId: string): string[] {
  return [...mediaCacheDir(mediaId), CACHE_TRANSCRIPT_FILENAME_LEGACY];
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

/* ---------------- Content-deduped shared store ---------------- */
//
// Proxies are shared across mediaIds that resolve to the same source (via
// content hash or file fingerprint), so they live under `content/proxies/`
// rather than `media/<id>/cache/` — different mediaIds can reuse the same
// proxy file. The sibling `content/<hash[0:2]>/<hash>/` tree is reserved
// for future source-blob dedup via `contentDir()` / `contentDataPath()`.

export const CONTENT_PROXIES_DIR = 'proxies';

export function proxiesRoot(): string[] {
  return [CONTENT_DIR, CONTENT_PROXIES_DIR];
}

export function proxyFilePath(proxyKey: string): string[] {
  return [...proxiesRoot(), proxyKey, 'proxy.mp4'];
}

export function proxyMetaPath(proxyKey: string): string[] {
  return [...proxiesRoot(), proxyKey, 'meta.json'];
}

export function proxyDir(proxyKey: string): string[] {
  return [...proxiesRoot(), proxyKey];
}
