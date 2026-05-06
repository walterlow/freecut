export interface SceneCaptionData {
  caption?: string
  shotType?: string
  subjects?: string[]
  action?: string
  setting?: string
  lighting?: string
  timeOfDay?: string
  weather?: string
}

export interface MediaCaption {
  timeSec: number
  text: string
  /**
   * Structured scene metadata emitted by the caption model. Preserved for
   * future semantic/indexing work while `text` remains the user-facing and
   * search-facing sentence.
   */
  sceneData?: SceneCaptionData
  /**
   * Workspace-relative path to a captured JPEG thumbnail for this scene,
   * e.g. `media/{mediaId}/cache/ai/captions-thumbs/{index}.jpg`. Absent on
   * captions generated before the Scene Browser feature landed.
   */
  thumbRelPath?: string
  /**
   * Dense sentence embedding of the caption's embed-text (caption +
   * transcript + colors). 384-dim for all-MiniLM-L6-v2. When present,
   * enables semantic text search.
   */
  embedding?: number[]
  /**
   * Structural dominant-color palette for the thumbnail, in CIELAB
   * with pixel-coverage weights. Powers ∆E-based color-query ranking
   * independent of CLIP — Lab distances are perceptually uniform so
   * "red" queries actually hit red scenes rather than whatever CLIP
   * happens to associate with the token.
   */
  palette?: Array<{ l: number; a: number; b: number; weight: number }>
}

export interface CaptioningProgress {
  stage: 'loading-model' | 'captioning'
  percent: number
  framesAnalyzed: number
  totalFrames: number
}

export interface CaptioningOptions {
  onProgress?: (progress: CaptioningProgress) => void
  signal?: AbortSignal
  sampleIntervalSec?: number
  /**
   * Optional persistence hook invoked once per captioned frame with the
   * JPEG the provider already captured for VLM inference. Return a
   * workspace-relative path to stash on `MediaCaption.thumbRelPath`;
   * return `undefined` to skip the thumbnail for that frame.
   */
  saveThumbnail?: (index: number, blob: Blob) => Promise<string | undefined>
}

export interface MediaCaptioningProvider {
  id: string
  label: string
  captionVideo(video: HTMLVideoElement, options?: CaptioningOptions): Promise<MediaCaption[]>
  captionImage(imageBlob: Blob, options?: CaptioningOptions): Promise<MediaCaption[]>
}
