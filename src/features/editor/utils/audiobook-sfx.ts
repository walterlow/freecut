import type { MediaTranscript } from '@/types/storage'

export type AudiobookSfxCueRole = 'ambience' | 'foreground' | 'impact' | 'transition'

export interface AudiobookSfxCue {
  id: string
  label: string
  role: AudiobookSfxCueRole
  prompt: string
  reason: string
  sourceText: string
  startSeconds: number
  endSeconds: number
  mixVolumeDb: number
  guidanceScale: number
}

export interface AudiobookSfxPlanOptions {
  maxCues?: number
  durationSeconds?: number
  minSpacingSeconds?: number
  narrationDurationSeconds?: number
}

interface CueRule {
  category: string
  label: string
  role: AudiobookSfxCueRole
  terms: string[]
  prompt: string
  priority: number
  mixVolumeDb: number
  guidanceScale: number
  maxPerPlan?: number
}

interface CueCandidate extends AudiobookSfxCue {
  category: string
  priority: number
  maxPerPlan?: number
}

interface ResolvedAudiobookSfxPlanOptions {
  maxCues: number
  cueDurationSeconds: number
  minSpacingSeconds: number
  narrationDurationSeconds: number
}

const DEFAULT_MAX_CUES = 42
const DEFAULT_DURATION_SECONDS = 12
const DEFAULT_MIN_SPACING_SECONDS = 2.0
const MAX_CUES = 64
const MAX_DURATION_SECONDS = 30
const FOREGROUND_TIMELINE_BOOST_DB = 5.8
const IMPACT_TIMELINE_BOOST_DB = 5.6
const AMBIENCE_TIMELINE_BOOST_DB = 2.2
const CINEMATIC_QUALITY_PROMPT_PREFIX =
  'major-studio feature-film sound library quality, source-recorded Foley aesthetic, discrete non-musical sound effect cue, layered professional sound-design stem with separate low body, close transient, tactile midrange texture, debris movement, and room tail, realistic physical detail, imperfect practical source layers, high-resolution theatrical sound design, wide stereo depth, clean fast transients, muscular low-mid body, premium post-production polish, unmistakable cinematic presence under narration, rich full-bodied sound, expensive licensed studio library character, controlled headroom, no clipped limiter smear, not thin, not cheap, not synthetic, not toy-like, not a music loop, not a smooth sine boom, not a generic AI sweep, not a simple tonal swell, not a flat whoosh pad'
const FOREGROUND_PROMPT_SUFFIX =
  'distinct foreground cinematic sound effect, layered close-mic Foley detail, crisp transient clarity, tactile midrange texture, audible body, small physical imperfections, short natural room tail, clear but not over-limited under narration, not faint, not background ambience, no melody, no drums, no musical rhythm, no dialogue, no voice, no vocals'
const IMPACT_PROMPT_SUFFIX =
  'designed foreground impact cue for a dramatic film scene, three-stage movie punctuation with subtle pre-whoosh, physical transient, controlled sub body, close Foley texture, wood or metal contact detail, debris scatter, cinematic pressure bloom, airy theatrical tail, strong presence under narration without clipping, large but clean, no clipped distortion, no crushed limiter, not faint, not ambience, no melody, no drums, no musical rhythm, no dialogue, no voice, no vocals'
const AMBIENCE_PROMPT_SUFFIX =
  'supporting cinematic ambience bed, location-specific room tone, rich but controlled natural texture, wide stereo movement, audible atmosphere that remains below narration, polished film post-production quality, active but not distracting, not empty silence, no melody, no drums, no musical rhythm, no dialogue, no voice, no vocals'
const IMPACT_ANCHOR_RATIOS = [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.92]
const EDITORIAL_IMPACT_TERMS = [
  'secret',
  'truth',
  'choice',
  'decision',
  'power',
  'privacy',
  'promise',
  'broken',
  'hidden',
  'warning',
  'judge',
  'senator',
  'forbes',
  'reveal',
  'trust',
  'cover',
  'named',
  'realized',
  'suddenly',
  'silence',
  'never',
  'always',
  'first',
  'last',
  'wanted',
  'fear',
  'heart',
  'danger',
  'betrayal',
  'alone',
  'but',
  'however',
  'only',
  'finally',
]

const CUE_RULES: CueRule[] = [
  {
    category: 'title-card',
    label: 'Chapter sting',
    role: 'transition',
    terms: ['epigraph', 'part', 'chapter', 'novel', 'prologue'],
    prompt:
      'premium cinematic audiobook chapter transition sting with real reverse-air pickup, close page or desk transient, controlled sub swell, crisp editorial marker, expensive dramatic tail, sound effect only, no speech',
    priority: 8.5,
    mixVolumeDb: 3,
    guidanceScale: 6.2,
    maxPerPlan: 2,
  },
  {
    category: 'newsroom',
    label: 'Newsroom',
    role: 'ambience',
    terms: [
      'journalist',
      'journalism',
      'editor',
      'newsroom',
      'assignment',
      'source',
      'interviewed',
      'filed',
      'words',
      'desk',
    ],
    prompt:
      'high-end investigative newsroom ambience with quiet keyboards, distant office tone, HVAC air, present room pressure, cinematic sound design, no music, no speech',
    priority: 8,
    mixVolumeDb: -3,
    guidanceScale: 5.4,
    maxPerPlan: 3,
  },
  {
    category: 'folder-paper',
    label: 'Folder foley',
    role: 'foreground',
    terms: ['folder', 'manila', 'page', 'paper', 'opened', 'closed', 'file', 'files', 'slid'],
    prompt:
      'close cinematic foley of a manila folder sliding open with crisp paper movement, small desk impact, polished investigative drama sound effect, no music, no speech',
    priority: 8,
    mixVolumeDb: 4,
    guidanceScale: 6.5,
    maxPerPlan: 6,
  },
  {
    category: 'phone-keyboard',
    label: 'Phone and keys',
    role: 'foreground',
    terms: ['phone', 'texting', 'texted', 'text', 'texts', 'source', 'keyboard', 'typing'],
    prompt:
      'clean close phone typing and newsroom keyboard foley with bright tactile clicks, soft office room tone, cinematic sound effect, no speech',
    priority: 7.5,
    mixVolumeDb: 2.5,
    guidanceScale: 6.1,
    maxPerPlan: 4,
  },
  {
    category: 'public-power',
    label: 'Public power',
    role: 'impact',
    terms: [
      'senator',
      'senators',
      'federal',
      'judge',
      'committee',
      'senate',
      'forbes',
      'ted',
      'public',
      'trust',
    ],
    prompt:
      'political thriller reveal hit with real desk/paper/metal punctuation, deep room tone, distant press ambience, controlled sub body, crisp physical transient, expensive cinematic tension, low impact and airy tail, sound effect only, no speech',
    priority: 8.25,
    mixVolumeDb: 4,
    guidanceScale: 6.5,
    maxPerPlan: 7,
  },
  {
    category: 'secrecy',
    label: 'Secrecy',
    role: 'impact',
    terms: [
      'undercover',
      'agency',
      'discretion',
      'privacy',
      'private',
      'secret',
      'vets',
      'vetting',
      'accepted',
      'client',
      'clients',
    ],
    prompt:
      'cinematic secrecy and investigation pulse with close paper drag, private office pressure, small tactile reveal transient, low suspense body, refined thriller sound effect, no speech',
    priority: 8,
    mixVolumeDb: 2,
    guidanceScale: 6,
    maxPerPlan: 5,
  },
  {
    category: 'name-reveal',
    label: 'Name reveal',
    role: 'impact',
    terms: ['dominique', 'dominic', 'voss', 'subject', 'named', 'cover', 'leverage'],
    prompt:
      'premium character name reveal sound design with close card or folder snap, low polished impact, crisp reveal transient, airy suspense tail, dramatic film-trailer restraint, no music, no speech',
    priority: 8.5,
    mixVolumeDb: 4.5,
    guidanceScale: 6.6,
    maxPerPlan: 3,
  },
  {
    category: 'decision',
    label: 'Decision beat',
    role: 'impact',
    terms: [
      'decision',
      'resistance',
      'certainty',
      'objection',
      'objections',
      'accepted',
      'assigning',
    ],
    prompt:
      'decision beat with low cinematic pulse, quiet room pressure, close physical tick or desk accent, clean dramatic transient, expensive editorial tail, polished audiobook sound design, no speech',
    priority: 7.5,
    mixVolumeDb: 2,
    guidanceScale: 6,
    maxPerPlan: 5,
  },
  {
    category: 'storm',
    label: 'Storm',
    role: 'foreground',
    terms: ['thunder', 'lightning', 'storm', 'rain', 'downpour'],
    prompt:
      'cinematic storm sound effect with wide rain texture, distant thunder roll, dramatic low-end air, sound effect only, no music, no speech',
    priority: 9,
    mixVolumeDb: 0,
    guidanceScale: 5.8,
    maxPerPlan: 4,
  },
  {
    category: 'door',
    label: 'Door',
    role: 'foreground',
    terms: ['door', 'gate', 'hinge', 'knock', 'opened', 'closed', 'creak'],
    prompt:
      'cinematic wooden door creak with close hinge detail, small room impact, soft room tone, detailed sound effect, no music, no speech',
    priority: 8,
    mixVolumeDb: 3.5,
    guidanceScale: 6.4,
    maxPerPlan: 5,
  },
  {
    category: 'footsteps',
    label: 'Footsteps',
    role: 'foreground',
    terms: ['footstep', 'footsteps', 'walked', 'walking', 'ran', 'running', 'tiptoe', 'steps'],
    prompt:
      'cinematic footsteps with natural floor detail, close foley texture, controlled room ambience, sound effect only, no music, no speech',
    priority: 8,
    mixVolumeDb: 2,
    guidanceScale: 6,
    maxPerPlan: 5,
  },
  {
    category: 'clock',
    label: 'Clock',
    role: 'foreground',
    terms: ['clock', 'watch', 'tick', 'ticking', 'chime', 'bell', 'bells', 'time'],
    prompt:
      'antique clock ticking with crisp mechanical detail and gentle chime, polished cinematic foley sound effect, no music, no speech',
    priority: 8,
    mixVolumeDb: 1,
    guidanceScale: 5.8,
    maxPerPlan: 4,
  },
  {
    category: 'magic',
    label: 'Magic',
    role: 'foreground',
    terms: ['magic', 'spark', 'glow', 'shimmer', 'spell', 'enchanted', 'key', 'portal'],
    prompt:
      'delicate magical shimmer with tiny golden sparks, bright cinematic fantasy detail, soft glowing tail, no music, no speech',
    priority: 8,
    mixVolumeDb: 2,
    guidanceScale: 6.2,
    maxPerPlan: 4,
  },
  {
    category: 'wind',
    label: 'Wind',
    role: 'ambience',
    terms: ['wind', 'breeze', 'leaves', 'forest', 'trees', 'night', 'moon', 'stars'],
    prompt:
      'soft night wind with gentle leaves and distant atmosphere, wide cinematic ambience with audible movement, no music, no speech',
    priority: 7,
    mixVolumeDb: -5,
    guidanceScale: 5,
    maxPerPlan: 3,
  },
  {
    category: 'water',
    label: 'Water',
    role: 'ambience',
    terms: ['water', 'river', 'sea', 'ocean', 'waves', 'rainfall', 'stream', 'lake'],
    prompt:
      'gentle cinematic water movement with soft environmental ambience, wide natural texture, sound effect only, no music, no speech',
    priority: 7,
    mixVolumeDb: -5,
    guidanceScale: 5,
    maxPerPlan: 3,
  },
  {
    category: 'fire',
    label: 'Fire',
    role: 'ambience',
    terms: ['fire', 'flame', 'candle', 'torch', 'hearth', 'burning', 'crackle'],
    prompt:
      'warm crackling fire and clear ember pops, intimate cinematic foley sound effect with present texture, no music, no speech',
    priority: 7,
    mixVolumeDb: -2,
    guidanceScale: 5.5,
    maxPerPlan: 4,
  },
  {
    category: 'metal',
    label: 'Metal',
    role: 'foreground',
    terms: ['sword', 'metal', 'gear', 'gears', 'machine', 'lock', 'chain', 'mechanical'],
    prompt:
      'polished metal mechanism clicks and gear turns with bright close detail, cinematic foley sound effect, no music, no speech',
    priority: 7,
    mixVolumeDb: 3.5,
    guidanceScale: 6.4,
    maxPerPlan: 5,
  },
  {
    category: 'city',
    label: 'Town',
    role: 'ambience',
    terms: ['city', 'town', 'street', 'market', 'crowd', 'village', 'carriage'],
    prompt:
      'distant old town ambience with soft movement and muted life, wide cinematic background sound effect, no music, no speech',
    priority: 6,
    mixVolumeDb: -5,
    guidanceScale: 5,
    maxPerPlan: 3,
  },
  {
    category: 'animal',
    label: 'Creature',
    role: 'foreground',
    terms: ['bird', 'birds', 'wings', 'horse', 'dog', 'cat', 'creature'],
    prompt:
      'gentle creature movement with clear wing detail and natural ambience, cinematic sound effect, no music, no speech',
    priority: 6,
    mixVolumeDb: 1,
    guidanceScale: 5.8,
    maxPerPlan: 4,
  },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

function findWordStartSeconds(
  words: NonNullable<MediaTranscript['segments'][number]['words']>,
  terms: string[],
  fallback: number,
): number {
  for (const word of words) {
    const normalized = normalizeForMatch(word.text)
    if (terms.some((term) => normalized === term || normalized.startsWith(`${term}'`))) {
      return word.start
    }
  }
  return fallback
}

function inferAmbientRule(text: string): CueRule {
  const normalized = normalizeForMatch(text)
  const matchingRule = CUE_RULES.find((rule) =>
    rule.terms.some((term) => includesTerm(normalized, term)),
  )
  if (matchingRule) return matchingRule

  return {
    category: 'story-ambience',
    label: 'Story ambience',
    role: 'ambience',
    terms: [],
    prompt:
      'cinematic audiobook scene ambience with soft emotional room tone, controlled air movement, subtle real-world texture, polished film sound bed, no music, no speech',
    priority: 1,
    mixVolumeDb: -6,
    guidanceScale: 5,
  }
}

export function getAudiobookSfxTimelineVolumeDb(
  cue: Pick<AudiobookSfxCue, 'mixVolumeDb'> & Partial<Pick<AudiobookSfxCue, 'role'>>,
): number {
  const role = cue.role ?? (cue.mixVolumeDb <= -6 ? 'ambience' : 'foreground')

  if (role === 'ambience') {
    return clamp(cue.mixVolumeDb + AMBIENCE_TIMELINE_BOOST_DB, -8, -1.5)
  }

  if (role === 'impact' || role === 'transition') {
    return clamp(cue.mixVolumeDb + IMPACT_TIMELINE_BOOST_DB, 8, 11.5)
  }

  return clamp(cue.mixVolumeDb + FOREGROUND_TIMELINE_BOOST_DB, 5.5, 10.5)
}

function buildEnhancedPrompt(rule: CueRule, sourceText: string): string {
  const suffix =
    rule.role === 'ambience'
      ? AMBIENCE_PROMPT_SUFFIX
      : rule.role === 'impact' || rule.role === 'transition'
        ? IMPACT_PROMPT_SUFFIX
        : FOREGROUND_PROMPT_SUFFIX
  const roleBrief =
    rule.role === 'ambience'
      ? 'Design this as a continuous scene layer with audible motion and texture for most of the requested duration, giving the narration a believable physical world'
      : rule.role === 'impact' || rule.role === 'transition'
        ? 'Design this as a bold dramatic movie punctuation cue with audible micro-layers: reverse air, a real tactile hit, low body, debris movement, room slap, premium decay, and enough dynamics to feel like a real film-library hit'
        : 'Design this as a layered foreground Foley event with close detail, clear body, and a natural production tail'
  const storyMoment = cleanText(sourceText).slice(0, 120)
  return storyMoment
    ? `${CINEMATIC_QUALITY_PROMPT_PREFIX}. ${roleBrief}. ${rule.prompt}. ${suffix}. Story moment: ${storyMoment}`
    : `${CINEMATIC_QUALITY_PROMPT_PREFIX}. ${roleBrief}. ${rule.prompt}. ${suffix}`
}

function buildAmbientFallbackCues(
  transcript: MediaTranscript,
  maxCues: number,
  cueDurationSeconds: number,
  narrationDurationSeconds: number,
): AudiobookSfxCue[] {
  const duration = Math.max(
    narrationDurationSeconds,
    transcript.segments.at(-1)?.end ?? 0,
    cueDurationSeconds,
  )
  const cueCount = clamp(Math.ceil(duration / 35), 1, Math.min(3, maxCues))
  const rule = inferAmbientRule(transcript.text)

  return Array.from({ length: cueCount }, (_, index) => {
    const start =
      cueCount === 1
        ? 0
        : Math.round(((index * duration) / cueCount + Math.min(2, duration * 0.08)) * 10) / 10
    const boundedStart = clamp(start, 0, Math.max(0, duration - 0.5))
    return {
      id: `ambient-${index + 1}`,
      label: rule.label,
      role: 'ambience',
      prompt: buildEnhancedPrompt(rule, transcript.text),
      reason: 'Ambient bed',
      sourceText: cleanText(transcript.text).slice(0, 180),
      startSeconds: boundedStart,
      endSeconds: Math.min(duration, boundedStart + cueDurationSeconds),
      mixVolumeDb: rule.mixVolumeDb,
      guidanceScale: rule.guidanceScale,
    }
  })
}

function buildOpeningStingCue(
  transcript: MediaTranscript,
  cueDurationSeconds: number,
  narrationDurationSeconds: number,
): AudiobookSfxCue {
  const sourceText = findSourceTextNearSeconds(transcript, 0)

  return {
    id: 'opening-cinematic-sting',
    label: 'Opening sting',
    role: 'transition',
    prompt: `${CINEMATIC_QUALITY_PROMPT_PREFIX}. Premium cinematic audiobook opening sting, deep controlled swell, clean editorial impact, clear reverse-air pickup, expensive short tail, sound effect only, no music, no speech. ${IMPACT_PROMPT_SUFFIX}. Story moment: ${sourceText}`,
    reason: 'Opening story punctuation',
    sourceText,
    startSeconds: 0.2,
    endSeconds: Math.min(narrationDurationSeconds, cueDurationSeconds),
    mixVolumeDb: 5.5,
    guidanceScale: 7.2,
  }
}

function getTargetImpactCueCount(narrationDurationSeconds: number, maxCues: number): number {
  if (narrationDurationSeconds < 45 || maxCues < 4) return 0
  return clamp(Math.ceil(narrationDurationSeconds / 38), 3, Math.min(12, Math.floor(maxCues / 2)))
}

function editorialImpactScore(text: string): number {
  const normalized = normalizeForMatch(text)
  if (!normalized) return 0

  const termScore = EDITORIAL_IMPACT_TERMS.reduce(
    (score, term) => score + (includesTerm(normalized, term) ? 1 : 0),
    0,
  )
  const punctuationScore = /[?!]/.test(text) ? 0.6 : 0
  const contrastScore = /\b(but|however|until|unless|except)\b/i.test(text) ? 0.8 : 0
  const shortLineScore = normalized.split(/\s+/).filter(Boolean).length <= 12 ? 0.35 : 0

  return termScore + punctuationScore + contrastScore + shortLineScore
}

function buildEditorialImpactCandidate(params: {
  segment: MediaTranscript['segments'][number]
  segmentIndex: number
  score: number
  cueDurationSeconds: number
  narrationDurationSeconds: number
}): CueCandidate {
  const { segment, segmentIndex, score, cueDurationSeconds, narrationDurationSeconds } = params
  const sourceText = cleanText(segment.text)
  const startSeconds = clamp(segment.start, 0, Math.max(0, narrationDurationSeconds))

  return {
    id: `editorial-impact-${segmentIndex + 1}`,
    category: 'editorial-impact',
    priority: 5.8 + Math.min(3.2, score),
    label: 'Story hit',
    role: 'impact',
    prompt: `${CINEMATIC_QUALITY_PROMPT_PREFIX}. Design this as a bold dramatic movie punctuation cue with a clear reverse, physical transient, low body, debris texture, room slap, and premium decay. Premium cinematic editorial story-turn hit for audiobook narration, deep low-frequency punctuation, restrained trailer-quality pulse, crisp close Foley detail, short dramatic tail, sound effect only. ${IMPACT_PROMPT_SUFFIX}. Story moment: ${sourceText.slice(0, 140)}`,
    reason: 'Story turn',
    sourceText,
    startSeconds,
    endSeconds: Math.min(narrationDurationSeconds, startSeconds + cueDurationSeconds),
    mixVolumeDb: 5.2,
    guidanceScale: 7.5,
  }
}

function countPunctuationCues(cues: AudiobookSfxCue[]): number {
  return cues.filter((cue) => cue.role === 'impact' || cue.role === 'transition').length
}

function isAudibleBeatCue(cue: AudiobookSfxCue): boolean {
  return cue.role === 'foreground' || cue.role === 'impact' || cue.role === 'transition'
}

function cueCoversStoryBeat(cue: AudiobookSfxCue, beatSeconds: number): boolean {
  if (!isAudibleBeatCue(cue)) return false
  const cueStart = Math.max(0, cue.startSeconds)
  const cueEnd = Math.max(cueStart, cue.endSeconds)
  return cueStart <= beatSeconds + 8 && cueEnd >= beatSeconds - 4
}

function buildSceneTurnImpactCue(params: {
  index: number
  startSeconds: number
  cueDurationSeconds: number
  narrationDurationSeconds: number
  sourceText: string
}): AudiobookSfxCue {
  const startSeconds = clamp(params.startSeconds, 0, Math.max(0, params.narrationDurationSeconds))

  return {
    id: `scene-turn-impact-${params.index + 1}`,
    label: 'Scene turn hit',
    role: 'impact',
    prompt: `${CINEMATIC_QUALITY_PROMPT_PREFIX}. Design this as a bold dramatic movie punctuation cue with a clear reverse, physical transient, low body, debris texture, room slap, and premium decay. Premium cinematic audiobook scene-turn hit, layered sub boom, tactile editorial transient, controlled reverse air, expensive decay tail, theatrical but not musical, sound effect only. ${IMPACT_PROMPT_SUFFIX}. Story moment: ${params.sourceText.slice(0, 140)}`,
    reason: 'Scene turn',
    sourceText: params.sourceText,
    startSeconds,
    endSeconds: Math.min(params.narrationDurationSeconds, startSeconds + params.cueDurationSeconds),
    mixVolumeDb: 5.4,
    guidanceScale: 7.6,
  }
}

function collectEditorialImpactCandidates(
  transcript: MediaTranscript,
  options: ResolvedAudiobookSfxPlanOptions,
): CueCandidate[] {
  return transcript.segments
    .map((segment, segmentIndex) => {
      const score = editorialImpactScore(segment.text)
      return score > 0
        ? buildEditorialImpactCandidate({
            segment,
            segmentIndex,
            score,
            cueDurationSeconds: options.cueDurationSeconds,
            narrationDurationSeconds: options.narrationDurationSeconds,
          })
        : null
    })
    .filter((candidate): candidate is CueCandidate => Boolean(candidate))
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority
      return left.startSeconds - right.startSeconds
    })
}

function canAddMorePunctuation(
  cues: AudiobookSfxCue[],
  targetImpactCueCount: number,
  maxCues: number,
): boolean {
  return cues.length < maxCues && countPunctuationCues(cues) < targetImpactCueCount
}

function addOpeningStingIfNeeded(
  planned: AudiobookSfxCue[],
  transcript: MediaTranscript,
  options: ResolvedAudiobookSfxPlanOptions,
): void {
  if (
    options.narrationDurationSeconds < 30 ||
    planned.length >= options.maxCues ||
    cueHasNearbyStart(planned, 0.2, Math.min(6, options.minSpacingSeconds))
  ) {
    return
  }

  planned.push(
    buildOpeningStingCue(transcript, options.cueDurationSeconds, options.narrationDurationSeconds),
  )
}

function addEditorialImpactCues(params: {
  planned: AudiobookSfxCue[]
  transcript: MediaTranscript
  options: ResolvedAudiobookSfxPlanOptions
  targetImpactCueCount: number
}): void {
  const { planned, transcript, options, targetImpactCueCount } = params

  for (const candidate of collectEditorialImpactCandidates(transcript, options)) {
    if (!canAddMorePunctuation(planned, targetImpactCueCount, options.maxCues)) break
    if (cueHasNearbyStart(planned, candidate.startSeconds, options.minSpacingSeconds * 0.9)) {
      continue
    }
    planned.push(candidate)
  }
}

function addUncoveredStoryBeatImpactCues(params: {
  planned: AudiobookSfxCue[]
  transcript: MediaTranscript
  options: ResolvedAudiobookSfxPlanOptions
}): void {
  const { planned, transcript, options } = params
  const maxAddedBeatCues = Math.min(
    8,
    Math.max(1, Math.ceil(options.narrationDurationSeconds / 45)),
  )
  let addedBeatCues = 0

  for (const candidate of collectEditorialImpactCandidates(transcript, options)) {
    if (planned.length >= options.maxCues || addedBeatCues >= maxAddedBeatCues) break
    if (candidate.priority < 6.8) continue
    if (planned.some((cue) => cue.id === candidate.id)) continue
    if (planned.some((cue) => cueCoversStoryBeat(cue, candidate.startSeconds))) continue

    planned.push(candidate)
    addedBeatCues += 1
  }
}

function addSceneTurnImpactCues(params: {
  planned: AudiobookSfxCue[]
  transcript: MediaTranscript
  options: ResolvedAudiobookSfxPlanOptions
  targetImpactCueCount: number
}): void {
  const { planned, transcript, options, targetImpactCueCount } = params

  for (const [index, ratio] of IMPACT_ANCHOR_RATIOS.entries()) {
    if (!canAddMorePunctuation(planned, targetImpactCueCount, options.maxCues)) break

    const desiredStartSeconds = options.narrationDurationSeconds * ratio
    const startSeconds = findAvailableAmbienceStart({
      cues: planned,
      desiredStartSeconds,
      narrationDurationSeconds: options.narrationDurationSeconds,
      minSpacingSeconds: options.minSpacingSeconds * 0.9,
    })
    if (startSeconds == null) continue

    planned.push(
      buildSceneTurnImpactCue({
        index,
        startSeconds,
        cueDurationSeconds: options.cueDurationSeconds,
        narrationDurationSeconds: options.narrationDurationSeconds,
        sourceText: findSourceTextNearSeconds(transcript, startSeconds),
      }),
    )
  }
}

function addCinematicPunctuationCues(
  cues: AudiobookSfxCue[],
  transcript: MediaTranscript,
  options: ResolvedAudiobookSfxPlanOptions,
): AudiobookSfxCue[] {
  const planned = [...cues]
  addOpeningStingIfNeeded(planned, transcript, options)
  addUncoveredStoryBeatImpactCues({ planned, transcript, options })

  const targetImpactCueCount = getTargetImpactCueCount(
    options.narrationDurationSeconds,
    options.maxCues,
  )
  const currentImpactCueCount = countPunctuationCues(planned)
  const missingImpactCueCount = Math.min(
    Math.max(0, targetImpactCueCount - currentImpactCueCount),
    Math.max(0, options.maxCues - planned.length),
  )
  if (missingImpactCueCount === 0) {
    return planned.sort((left, right) => left.startSeconds - right.startSeconds)
  }

  addEditorialImpactCues({ planned, transcript, options, targetImpactCueCount })
  addSceneTurnImpactCues({ planned, transcript, options, targetImpactCueCount })

  return planned.sort((left, right) => left.startSeconds - right.startSeconds)
}

function resolvePlanOptions(
  transcript: MediaTranscript,
  options: AudiobookSfxPlanOptions,
): ResolvedAudiobookSfxPlanOptions {
  return {
    maxCues: clamp(Math.round(options.maxCues ?? DEFAULT_MAX_CUES), 1, MAX_CUES),
    cueDurationSeconds: clamp(
      options.durationSeconds ?? DEFAULT_DURATION_SECONDS,
      0.5,
      MAX_DURATION_SECONDS,
    ),
    minSpacingSeconds: clamp(options.minSpacingSeconds ?? DEFAULT_MIN_SPACING_SECONDS, 1, 30),
    narrationDurationSeconds: Math.max(
      options.narrationDurationSeconds ?? 0,
      transcript.segments.at(-1)?.end ?? 0,
    ),
  }
}

function buildCandidateForRule(params: {
  segment: MediaTranscript['segments'][number]
  segmentIndex: number
  rule: CueRule
  matchedTerms: string[]
  cueDurationSeconds: number
  narrationDurationSeconds: number
}): CueCandidate {
  const {
    segment,
    segmentIndex,
    rule,
    matchedTerms,
    cueDurationSeconds,
    narrationDurationSeconds,
  } = params
  const wordStart = segment.words?.length
    ? findWordStartSeconds(segment.words, matchedTerms, segment.start)
    : segment.start
  const startSeconds = clamp(wordStart, 0, Math.max(0, narrationDurationSeconds || wordStart))
  const endSeconds = narrationDurationSeconds
    ? Math.min(narrationDurationSeconds, startSeconds + cueDurationSeconds)
    : startSeconds + cueDurationSeconds

  return {
    id: `cue-${segmentIndex + 1}-${rule.category}`,
    category: rule.category,
    maxPerPlan: rule.maxPerPlan,
    priority: rule.priority + Math.min(2, matchedTerms.length * 0.25),
    label: rule.label,
    role: rule.role,
    prompt: buildEnhancedPrompt(rule, segment.text),
    reason: matchedTerms.slice(0, 3).join(', '),
    sourceText: cleanText(segment.text),
    startSeconds,
    endSeconds,
    mixVolumeDb: rule.mixVolumeDb,
    guidanceScale: rule.guidanceScale,
  }
}

function collectCueCandidates(
  transcript: MediaTranscript,
  options: ResolvedAudiobookSfxPlanOptions,
): CueCandidate[] {
  return transcript.segments.flatMap((segment, segmentIndex) => {
    const normalized = normalizeForMatch(segment.text)
    if (!normalized) return []

    return CUE_RULES.flatMap((rule) => {
      const matchedTerms = rule.terms.filter((term) => includesTerm(normalized, term))
      return matchedTerms.length > 0
        ? [
            buildCandidateForRule({
              segment,
              segmentIndex,
              rule,
              matchedTerms,
              cueDurationSeconds: options.cueDurationSeconds,
              narrationDurationSeconds: options.narrationDurationSeconds,
            }),
          ]
        : []
    })
  })
}

function dedupeAndRankCandidates(candidates: CueCandidate[]): CueCandidate[] {
  return candidates
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority
      return left.startSeconds - right.startSeconds
    })
    .filter(
      (candidate, index, array) =>
        array.findIndex(
          (other) =>
            other.category === candidate.category &&
            Math.abs(other.startSeconds - candidate.startSeconds) < 1,
        ) === index,
    )
}

function selectSpacedCandidates(
  candidates: CueCandidate[],
  maxCues: number,
  minSpacingSeconds: number,
): CueCandidate[] {
  const selected: CueCandidate[] = []
  const categoryCounts = new Map<string, number>()
  const categoryCap = Math.max(1, Math.ceil(maxCues / 4))

  function canSelect(candidate: CueCandidate, enforceCategoryCap: boolean): boolean {
    if (selected.length >= maxCues) return false
    const currentCategoryCount = categoryCounts.get(candidate.category) ?? 0
    const hardCategoryCap = candidate.maxPerPlan ?? Number.POSITIVE_INFINITY
    if (currentCategoryCount >= hardCategoryCap) {
      return false
    }
    if (enforceCategoryCap && currentCategoryCount >= categoryCap) {
      return false
    }

    return !selected.some(
      (existing) => Math.abs(existing.startSeconds - candidate.startSeconds) < minSpacingSeconds,
    )
  }

  function select(candidate: CueCandidate): void {
    selected.push(candidate)
    categoryCounts.set(candidate.category, (categoryCounts.get(candidate.category) ?? 0) + 1)
  }

  for (const candidate of candidates) {
    if (canSelect(candidate, true)) select(candidate)
  }

  if (selected.length < maxCues) {
    for (const candidate of candidates) {
      const alreadySelected = selected.some((existing) => existing.id === candidate.id)
      if (!alreadySelected && canSelect(candidate, false)) select(candidate)
      if (selected.length >= maxCues) break
    }
  }

  return selected
}

function stripCandidateMetadata(candidates: CueCandidate[]): AudiobookSfxCue[] {
  return candidates
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map(({ category: _category, priority: _priority, maxPerPlan: _maxPerPlan, ...cue }) => cue)
}

function getTargetAmbienceCueCount(narrationDurationSeconds: number, maxCues: number): number {
  if (narrationDurationSeconds < 75 || maxCues < 4) return 0
  return clamp(Math.ceil(narrationDurationSeconds / 55), 2, Math.min(8, Math.floor(maxCues / 4)))
}

function cueHasNearbyStart(
  cues: AudiobookSfxCue[],
  startSeconds: number,
  minSpacingSeconds: number,
): boolean {
  return cues.some((cue) => Math.abs(cue.startSeconds - startSeconds) < minSpacingSeconds)
}

function findAvailableAmbienceStart(params: {
  cues: AudiobookSfxCue[]
  desiredStartSeconds: number
  narrationDurationSeconds: number
  minSpacingSeconds: number
}): number | null {
  const { cues, desiredStartSeconds, narrationDurationSeconds, minSpacingSeconds } = params
  const maxStart = Math.max(0, narrationDurationSeconds - 0.5)
  const offsets = [
    0,
    minSpacingSeconds,
    -minSpacingSeconds,
    minSpacingSeconds * 1.75,
    -minSpacingSeconds * 1.75,
  ]

  for (const offset of offsets) {
    const startSeconds = clamp(desiredStartSeconds + offset, 0, maxStart)
    if (!cueHasNearbyStart(cues, startSeconds, minSpacingSeconds * 0.75)) {
      return Math.round(startSeconds * 10) / 10
    }
  }

  return null
}

function findSourceTextNearSeconds(transcript: MediaTranscript, startSeconds: number): string {
  const segment =
    transcript.segments.find(
      (candidate) => candidate.start <= startSeconds && candidate.end >= startSeconds,
    ) ??
    transcript.segments.find((candidate) => candidate.start >= startSeconds) ??
    transcript.segments.at(-1)

  return cleanText(segment?.text ?? transcript.text).slice(0, 180)
}

function addCinematicContinuityBeds(
  cues: AudiobookSfxCue[],
  transcript: MediaTranscript,
  options: ResolvedAudiobookSfxPlanOptions,
): AudiobookSfxCue[] {
  const targetAmbienceCueCount = getTargetAmbienceCueCount(
    options.narrationDurationSeconds,
    options.maxCues,
  )
  if (targetAmbienceCueCount === 0) return cues

  const existingAmbienceCueCount = cues.filter((cue) => cue.role === 'ambience').length
  const availableSlots = Math.max(0, options.maxCues - cues.length)
  const missingAmbienceCueCount = Math.min(
    availableSlots,
    Math.max(0, targetAmbienceCueCount - existingAmbienceCueCount),
  )
  if (missingAmbienceCueCount === 0) return cues

  const rule = inferAmbientRule(transcript.text)
  const planned = [...cues]
  const interval = options.narrationDurationSeconds / Math.max(1, targetAmbienceCueCount)

  for (let index = 0; index < missingAmbienceCueCount; index += 1) {
    const desiredStartSeconds = index === 0 ? 0 : interval * (index + 0.25)
    const startSeconds = findAvailableAmbienceStart({
      cues: planned,
      desiredStartSeconds,
      narrationDurationSeconds: options.narrationDurationSeconds,
      minSpacingSeconds: options.minSpacingSeconds,
    })
    if (startSeconds == null) continue

    const sourceText = findSourceTextNearSeconds(transcript, startSeconds)
    planned.push({
      id: `continuity-bed-${index + 1}`,
      label: rule.label === 'Story ambience' ? 'Scene ambience' : rule.label,
      role: 'ambience',
      prompt: buildEnhancedPrompt(rule, sourceText || transcript.text),
      reason: 'Scene bed',
      sourceText,
      startSeconds,
      endSeconds: Math.min(
        options.narrationDurationSeconds,
        startSeconds + options.cueDurationSeconds,
      ),
      mixVolumeDb: clamp(rule.mixVolumeDb, -6, -3.5),
      guidanceScale: clamp(rule.guidanceScale + 0.3, 5.4, 6.1),
    })
  }

  return planned.sort((left, right) => left.startSeconds - right.startSeconds)
}

export function planAudiobookSoundEffects(
  transcript: MediaTranscript | undefined,
  options: AudiobookSfxPlanOptions = {},
): AudiobookSfxCue[] {
  if (!transcript || transcript.segments.length === 0) return []

  const resolvedOptions = resolvePlanOptions(transcript, options)
  const rankedCandidates = dedupeAndRankCandidates(
    collectCueCandidates(transcript, resolvedOptions),
  )
  const targetAmbienceCueCount = getTargetAmbienceCueCount(
    resolvedOptions.narrationDurationSeconds,
    resolvedOptions.maxCues,
  )
  const storyAccentBudget =
    targetAmbienceCueCount > 0
      ? Math.max(1, resolvedOptions.maxCues - targetAmbienceCueCount)
      : resolvedOptions.maxCues
  const cues = addCinematicPunctuationCues(
    stripCandidateMetadata(
      selectSpacedCandidates(
        rankedCandidates,
        storyAccentBudget,
        resolvedOptions.minSpacingSeconds,
      ),
    ),
    transcript,
    resolvedOptions,
  )

  if (cues.length > 0) {
    return addCinematicContinuityBeds(cues, transcript, resolvedOptions)
  }

  return addCinematicPunctuationCues(
    buildAmbientFallbackCues(
      transcript,
      resolvedOptions.maxCues,
      resolvedOptions.cueDurationSeconds,
      resolvedOptions.narrationDurationSeconds,
    ),
    transcript,
    resolvedOptions,
  )
}
