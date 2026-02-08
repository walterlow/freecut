/**
 * GPU media module entry points used by hooks/tests.
 */

export type { DecodedVideoFrame } from './types';

export {
  ManagedMediaSource,
  MediaSourceManager,
  createMediaSourceManager,
  type MediaSourceManagerConfig,
} from './media-source-manager';

export {
  TextureImporter,
  createTextureImporter,
  type ImportedTexture,
  type TextureImporterConfig,
} from './texture-import';
