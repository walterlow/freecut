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

/** Segments for `media/{id}/source.{ext}`. */
export function mediaSourcePath(id: string, extension: string): string[] {
  const ext = extension.startsWith('.') ? extension.slice(1) : extension;
  return [...mediaDir(id), `source.${ext}`];
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
