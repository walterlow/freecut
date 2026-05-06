/**
 * Media captioning facade.
 *
 * Consumers keep using `captionVideo` / `captionImage`, while the underlying
 * model-specific implementation is resolved through the captioning provider
 * registry. That lets us swap captioning models without changing call sites.
 */

import {
  getDefaultMediaCaptioningProvider,
  mediaCaptioningProviderRegistry,
  DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID,
} from './captioning/registry'
import type {
  CaptioningOptions,
  CaptioningProgress,
  MediaCaption,
  MediaCaptioningProvider,
} from './captioning/types'

export type { CaptioningOptions, CaptioningProgress, MediaCaption, MediaCaptioningProvider }

export { mediaCaptioningProviderRegistry, DEFAULT_MEDIA_CAPTIONING_PROVIDER_ID }

export async function captionVideo(
  video: HTMLVideoElement,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  return getDefaultMediaCaptioningProvider().captionVideo(video, options)
}

export async function captionImage(
  imageBlob: Blob,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  return getDefaultMediaCaptioningProvider().captionImage(imageBlob, options)
}
