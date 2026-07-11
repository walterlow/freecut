export type StudioAudioLicensePolicy = 'youtube-safe' | 'cc0-only'
export type StudioAudioSourceKind = 'preview' | 'original'
export type StudioAudioApproval = 'recommended' | 'approved' | 'rejected'
export type StudioAudioJobStage =
  | 'idle'
  | 'transcribing'
  | 'analyzing'
  | 'planning'
  | 'searching'
  | 'downloading'
  | 'mixing'
  | 'ready'
  | 'failed'
  | 'cancelled'

export interface FreesoundAssetMetadata {
  id: number
  name: string
  username: string
  license: string
  licenseCode: 'cc0' | 'cc-by' | 'share-alike' | 'non-commercial' | 'unknown'
  licenseUrl: string
  soundUrl: string
  previewUrl: string
  duration: number
  sampleRate: number
  bitDepth: number
  channels: number
  fileSize: number
  downloads: number
  rating: number
  description: string
  tags: string[]
  created: string
  score: number
}

export interface StudioAudioSourceMetadata {
  provider: 'freesound'
  soundId: number
  title: string
  creator: string
  sourceUrl: string
  license: string
  licenseUrl: string
  licenseCode: FreesoundAssetMetadata['licenseCode']
  retrievedAt: string
  sourceKind: StudioAudioSourceKind
  reason: string
  confidence: number
  approval: StudioAudioApproval
  locked: boolean
  sceneId?: string
}

export interface PixabayBrollAssetMetadata {
  assetKey: string
  id: number
  kind: 'video' | 'image'
  title: string
  tags: string
  pageUrl: string
  creator: string
  creatorId: number
  width: number
  height: number
  duration: number
  downloads: number
  likes: number
  editorsChoice: boolean
  variant: string
  score: number
}

export interface PixabayBrollSourceMetadata {
  provider: 'pixabay'
  assetId: number
  assetKind: 'video' | 'image'
  title: string
  creator: string
  sourceUrl: string
  licenseUrl: string
  retrievedAt: string
  query: string
  sceneId: string
  variant: string
  score: number
}

export interface PixabayBrollBeat {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
  query: string
}

export interface StudioAudioPlanEvent {
  id: string
  startSeconds: number
  endSeconds: number
  category: 'ambience' | 'foreground' | 'impact' | 'transition' | 'music'
  searchKeywords: string[]
  emotionalEffect: string
  suggestedVolumeDb: number
  fadeInSeconds: number
  fadeOutSeconds: number
  confidence: number
  explanation: string
  sourceText: string
  intentionallySilent?: boolean
  locked?: boolean
}

export interface StudioAudioSceneAnalysis {
  id: string
  chapterIndex: number
  startSeconds: number
  endSeconds: number
  title: string
  summary: string
  location: string
  timeOfDay: string
  weather: string
  moods: string[]
  actions: string[]
  ambienceKeywords: string[]
  musicMood: string
  silenceRecommended: boolean
  confidence: number
}

export interface StudioAudioRecoveredCue {
  cueId: string
  mediaId: string
  label: string
  audiobookSfxRole: 'ambience' | 'foreground' | 'impact' | 'transition'
  startFrame: number
  durationInFrames: number
  sourceDurationFrames: number
  sourceFps: number
  volume: number
  studioAudioSource?: StudioAudioSourceMetadata
}

export interface StudioAudioCredit extends StudioAudioSourceMetadata {
  projectId: string
  usedAtSeconds: number[]
  sceneNames: string[]
}

export interface StudioAudioJobState {
  id: string
  stage: StudioAudioJobStage
  completedCueIds: string[]
  failedCueIds: string[]
  progress: number
  updatedAt: number
  error?: string
}

export interface StudioAudioProductionState {
  schemaVersion: 1
  licensePolicy: StudioAudioLicensePolicy
  plan: StudioAudioPlanEvent[]
  scenes: StudioAudioSceneAnalysis[]
  credits: StudioAudioCredit[]
  recoveredCues: StudioAudioRecoveredCue[]
  job: StudioAudioJobState
  mixPreset:
    | 'subtle-audiobook'
    | 'cinematic-story'
    | 'romantic-drama'
    | 'suspense-mystery'
    | 'documentary'
    | 'intense-trailer'
    | 'custom'
  narrationLoudnessLufs: number
  truePeakDbtp: number
  updatedAt: number
}
