/**
 * Canvas Item Renderer
 *
 * Per-item render helpers that draw individual timeline items (video, image,
 * text, shape) to an OffscreenCanvas context.  Also contains the transition
 * compositing helper and shared geometry utilities.
 *
 * All functions are stateless – mutable renderer state is passed in via the
 * {@link ItemRenderContext} parameter.
 */

export type {
  CanvasSettings,
  ItemTransform,
  RenderImageSource,
  WorkerLoadedImage,
  ItemRenderContext,
  SubCompRenderData,
  GpuTextTextureCacheEntry,
  GpuBitmapMaskTextureCacheEntry,
  TransitionParticipantRenderState,
} from './types'

export { renderItem } from './render-item'

export {
  renderTransitionToCanvas,
  renderTransitionToGpuTexture,
  resolveTransitionParticipantRenderState,
} from './transition'

export { renderItemGpuEffectsToTexture, renderPreviewVideoGpuEffectsToCanvas } from './gpu'

export { calculateMediaDrawDimensions } from './media-draw'
