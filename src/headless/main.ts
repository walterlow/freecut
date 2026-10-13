/**
 * Headless render harness.
 *
 * This is a dedicated Vite entry (loaded by `headless.html`) that exposes a
 * small `window.freecut` API so a Node/Playwright driver can render projects to
 * video inside a real (headless) Chrome — reusing the exact same render engine
 * the editor uses, with no React UI, router, or workspace gate mounted.
 *
 * Browser APIs the render path depends on (WebCodecs, WebGPU, OffscreenCanvas,
 * OfflineAudioContext) all work in headless Chrome on a secure-context origin
 * (localhost), so fidelity matches the in-app export.
 *
 * Media is provided as fetchable URLs (served same-origin by the driver) and
 * seeded into `blobUrlManager`, so the real `resolveMediaUrls()` and the
 * engine's sub-composition media lookup resolve without the workspace/storage
 * layer being present.
 */
import type { Project } from '@/types/project'
import type { TimelineTrack, TimelineItem, TextItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AudioEqSettings } from '@/types/audio'
import type { CompositionInputProps } from '@/types/export'
import type { MediaMetadata } from '@/types/storage'
import type { ItemEffect } from '@/types/effects'

import { createLogger } from '@/shared/logging/logger'
import { CURRENT_SCHEMA_VERSION, migrateProject } from '@/shared/projects/migrations'
import type { ProjectWarning } from '@/shared/projects/migrations'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import { validateProject } from '@/features/project-bundle/schemas/project-schema'
import { mediaProcessorService } from '@/features/media-library/services/media-processor-service'
import { getMimeType, validateMediaFileContent } from '@/features/media-library/utils/validation'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import {
  renderComposition,
  renderAudioOnly,
  renderSingleFrame,
} from '@/features/export/utils/canvas-render-orchestrator'
import { getAnimatedTransform, buildKeyframesMap } from '@/features/export/utils/canvas-keyframes'
import type { ClientExportSettings, RenderProgress } from '@/features/export/utils/client-renderer'
import {
  getSupportedCodecs,
  selectFallbackVideoCodec,
  getPreferredContainerForCodec,
  getDefaultAudioCodec,
} from '@/features/export/utils/client-renderer'
import type { ClientVideoContainer } from '@/features/export/utils/client-renderer'
import { resolveMediaUrls } from '@/features/media-library/utils/media-resolver'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import {
  useCompositionsStore,
  type SubComposition,
} from '@/features/export/deps/timeline-compositions'
import { editProject } from './edit'
import { seedMediaLibrary } from './seed-media'
import {
  buildMediaMetadataMap,
  collectSourceRangeFindings,
  collectTransitionFindings,
  collectTransformParentFindings,
  hasAudioCapableItems,
} from './validation'
import { hasAudioContent } from '@/features/export/utils/canvas-audio'
import { ensureFontsLoaded } from '@/shared/typography/font-loader'
import {
  collectVisibleTextFontFamilies,
  resolveTrackRenderState,
} from '@/runtime/composition-runtime/utils/scene-assembly'
import { expandTextTransformToFitContent } from '@/runtime/composition-runtime/utils/text-layout'
import { layoutTextBlock, lineInkWidth } from '@/shared/typography/text-block-layout'
import { createCanvasTextMeasurer } from '@/shared/typography/text-measurer'
import { resolveAnimatedTextItem } from '@/features/keyframes/utils/animated-text-item'

const log = createLogger('Headless')

// Weights spanning the families the montage uses (medium 500 / bold 700 / heavy 800)
// plus 400/600 for safety. The editor preloads fonts via React preview mounts; the
// headless harness mounts none of those, so we must load fonts explicitly here.
const HEADLESS_FONT_WEIGHTS = [400, 500, 600, 700, 800]

/**
 * Block until the requested families are actually being APPLIED by the canvas
 * text renderer, not merely until their FontFace promises settled.
 *
 * Why this exists. `ensureFontsLoaded` awaits `document.fonts.load(...)`, and
 * that is not sufficient: Chrome resolves those promises a beat before the
 * export canvas starts picking the face up, so the first frames rasterise with
 * the fallback family. It is silent — no error, no warning, correct-looking
 * output — and it only shows up as geometry.
 *
 * Measured on the channel opener (2026-07-27): `dumpLayout` reported the word
 * "ИИ АГЕНТЫ" at 549.8px, while the render drew it at 575px for the first ~45
 * frames and 551px afterwards, i.e. 4.6% wider glyphs for the first 1.8s. The
 * switch frame MOVED WITH RENDER SPEED (frame 45 at --quality high, frame 29 at
 * --quality low), which is what proves it is a race rather than a fixed offset.
 *
 * Detection is by metrics, because that is the only thing that reflects what the
 * canvas will really draw: a loaded-but-not-yet-applied family measures exactly
 * like the generic fallback it is stacked on. We compare against two different
 * generics so a family that happens to match one of them cannot fool the check.
 */
async function awaitFontsApplied(
  families: readonly string[],
  weights: readonly number[],
  timeoutMs = 8000,
): Promise<string[]> {
  const unresolved: string[] = []
  if (families.length === 0 || typeof document === 'undefined') return unresolved

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return unresolved

  const deadline = Date.now() + timeoutMs
  const measure = (font: string): number => {
    ctx.font = font
    return ctx.measureText(PROBE).width
  }

  for (const family of new Set(families)) {
    const bare = family.replace(/^["']|["']$/g, '')
    for (const weight of weights) {
      if (!(await waitForFaceApplied(measure, bare, weight, deadline))) {
        unresolved.push(`${bare}:${weight}`)
      }
    }
  }
  // Let the compositor settle one frame before the first rasterisation.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  return unresolved
}

// Glyph-rich probe: Latin + Cyrillic + digits, so a family that only ships a
// partial subset cannot pass on a handful of shared glyphs.
const PROBE = 'HAMBURGEFONTSIVЖЯЦЩ0123456789'
const GENERICS = ['monospace', 'serif'] as const

/**
 * True once ONE family+weight measurably differs from the generics it is
 * stacked on, twice in a row.
 *
 * Two consecutive passes, not one: a single pass flips true the moment the face
 * lands in the font cache while the raster path can still be a beat behind —
 * measured as the switch merely MOVING EARLIER (frame 44 -> ~22) rather than
 * disappearing. Requiring the metric to hold across a gap covers the raster path.
 */
async function waitForFaceApplied(
  measure: (font: string) => number,
  family: string,
  weight: number,
  deadline: number,
): Promise<boolean> {
  const STABLE_PASSES = 2
  // A family still falling back measures identically to the generic it is stacked
  // on. Differing from BOTH generics means the face is really in use.
  const isApplied = (): boolean =>
    GENERICS.every(
      (generic) =>
        measure(`${weight} 100px "${family}", ${generic}`) !==
        measure(`${weight} 100px ${generic}`),
    )

  let streak = 0
  while (streak < STABLE_PASSES) {
    streak = isApplied() ? streak + 1 : 0
    if (streak >= STABLE_PASSES) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  return true
}

/**
 * The one font gate for every rasterising entry point: load the families each
 * visible text item needs, then block until they are really being applied.
 *
 * Single function on purpose. Without this the entry points drift — a caller
 * that awaits but drops the unresolved list reports success while drawing in
 * the fallback family, which is precisely the silent failure being fixed here.
 */
async function prepareFonts(
  tracks: CompositionInputProps['tracks'],
): Promise<HeadlessRenderWarning[]> {
  const families = collectVisibleTextFontFamilies(tracks)
  // Without this the Canvas text renderer draws with an unregistered family and
  // Chrome silently falls back to a generic sans-serif. No-ops offline.
  await ensureFontsLoaded(families, HEADLESS_FONT_WEIGHTS)
  const unresolved = await awaitFontsApplied(families, HEADLESS_FONT_WEIGHTS)
  if (unresolved.length === 0) return []
  return [
    {
      code: 'FONTS_NOT_APPLIED',
      message:
        `Fonts never became active within the budget: ${unresolved.join(', ')} — ` +
        'text is rasterised with a fallback family and its geometry will not match dumpLayout',
      details: { unresolved },
    },
  ]
}

interface HeadlessMediaSource {
  mediaId: string
  /** Same-origin (or CORS+CORP) URL the harness can fetch the full media bytes from. */
  url: string
  /**
   * The media's MediaMetadata (from the workspace `media/<id>/metadata.json`).
   * Seeded into the media-library store so codec lookups work — notably so
   * AC-3/E-AC-3 audio triggers the @mediabunny/ac3 decoder during export.
   */
  metadata?: MediaMetadata
}

/** Render from already-extracted timeline data (no Project schema required). */
interface HeadlessTimelineInput {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions?: Transition[]
  fps: number
  width: number
  height: number
  inPoint?: number | null
  outPoint?: number | null
  keyframes?: ItemKeyframes[]
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb?: number
  compositions?: SubComposition[]
  media?: HeadlessMediaSource[]
  settings: ClientExportSettings
  outputFileName?: string
  /** Fail before rendering if any validation warning was collected. */
  strict?: boolean
  /** Load-time validation findings collected by the caller (renderProject). */
  validationWarnings?: HeadlessRenderWarning[]
}

/** Render a full Project object (runs migrations, then extracts the timeline). */
interface HeadlessProjectInput {
  project: Project
  settings: ClientExportSettings
  media?: HeadlessMediaSource[]
  /** When true (default), ignore the project's in/out points and render everything. */
  renderWholeProject?: boolean
  /**
   * Explicit render range in project frames. When provided, overrides both the
   * project's stored in/out points and renderWholeProject. Useful for rendering
   * a slice of a long project from the CLI.
   */
  inPoint?: number | null
  outPoint?: number | null
  outputFileName?: string
  /** Fail before rendering if any validation warning was collected. */
  strict?: boolean
}

interface HeadlessRenderSummary {
  ok: true
  mimeType: string
  fileSize: number
  durationSeconds: number
  fileName: string
  /** Settings actually used after browser capability adaptation. */
  effectiveSettings: ClientExportSettings
  /** Non-fatal, machine-readable render degradations. */
  warnings: HeadlessRenderWarning[]
}

interface HeadlessRenderWarning {
  code:
    | 'CODEC_FALLBACK'
    | 'WEBGPU_TRANSITION_FALLBACK'
    | 'FONTS_NOT_APPLIED'
    | 'NO_AUDIO_IN_MIX'
    | ProjectWarning['code']
    | 'SOURCE_RANGE_EXCEEDED'
    | 'TRANSITION_CLIP_NOT_FOUND'
    | 'TRANSITION_CROSS_TRACK'
    | 'TRANSITION_NOT_ADJACENT'
    | 'TRANSITION_MISSING_PRESENTATION'
    | 'TRANSITION_INVALID_DIRECTION'
    | 'TRANSITION_UNSUPPORTED_PRESENTATION'
    | 'TRANSFORM_PARENT_NOT_FOUND'
    | 'TRANSFORM_PARENT_CYCLE'
    | 'TRANSFORM_PARENT_INVALID_TYPE'
  message: string
  details?: Record<string, unknown>
}

function projectWarningsToHeadless(warnings: ProjectWarning[]): HeadlessRenderWarning[] {
  return warnings.map((w) => ({
    code: w.code,
    message: w.message,
    details: {
      ...(w.itemIds ? { itemIds: w.itemIds } : {}),
      ...(w.trackId ? { trackId: w.trackId } : {}),
      ...(w.compositionId ? { compositionId: w.compositionId } : {}),
    },
  }))
}

/** Source-overrun findings for top-level and sub-composition items. */
function sourceRangeWarnings(
  items: readonly TimelineItem[],
  compositions: readonly SubComposition[] | undefined,
  mediaById: Map<string, MediaMetadata>,
  fps: number,
): HeadlessRenderWarning[] {
  const allItems = [
    ...items,
    ...(compositions ?? []).flatMap((comp) => (comp.items ?? []) as TimelineItem[]),
  ]
  return collectSourceRangeFindings(allItems, mediaById, fps).map((f) => ({
    code: 'SOURCE_RANGE_EXCEEDED' as const,
    message:
      `Item "${f.itemId}" needs ${f.neededSeconds.toFixed(2)}s of media "${f.mediaId}" ` +
      `but only ${f.availableSeconds.toFixed(2)}s exist — the tail renders black/silent`,
    details: { ...f },
  }))
}

const TRANSITION_WARNING_CODES = {
  clip_not_found: 'TRANSITION_CLIP_NOT_FOUND',
  cross_track: 'TRANSITION_CROSS_TRACK',
  not_adjacent: 'TRANSITION_NOT_ADJACENT',
  missing_presentation: 'TRANSITION_MISSING_PRESENTATION',
  invalid_direction: 'TRANSITION_INVALID_DIRECTION',
  unsupported_presentation: 'TRANSITION_UNSUPPORTED_PRESENTATION',
} as const

/** Transitions that would silently never render (or degrade to a hard cut). */
function transitionWarnings(
  transitions: readonly Transition[] | undefined,
  items: readonly TimelineItem[],
  // Which presentations can actually be drawn depends on the GPU: without it the
  // Canvas2D fallback covers only a handful and the rest become hard cuts.
  options: { gpuAvailable: boolean } = { gpuAvailable: false },
): HeadlessRenderWarning[] {
  return collectTransitionFindings(transitions ?? [], items, options).map((f) => ({
    code: TRANSITION_WARNING_CODES[f.kind],
    message: f.message,
    details: { transitionId: f.transitionId },
  }))
}

const TRANSFORM_PARENT_WARNING_CODES = {
  parent_not_found: 'TRANSFORM_PARENT_NOT_FOUND',
  cycle: 'TRANSFORM_PARENT_CYCLE',
  invalid_type: 'TRANSFORM_PARENT_INVALID_TYPE',
} as const

/** Transform-parent bindings that silently degrade (rig parts render unparented). */
function transformParentWarnings(items: readonly TimelineItem[]): HeadlessRenderWarning[] {
  return collectTransformParentFindings(items).map((f) => ({
    code: TRANSFORM_PARENT_WARNING_CODES[f.kind],
    message: f.message,
    details: { itemId: f.itemId },
  }))
}

/**
 * Warn (or throw in strict mode) when the composition has audio-capable items
 * but the extracted mix contains zero audible segments.
 */
async function collectSilentMixWarnings(
  composition: CompositionInputProps,
  mediaById: Map<string, MediaMetadata>,
  strict: boolean | undefined,
): Promise<HeadlessRenderWarning[]> {
  if (!hasAudioCapableItems(composition.tracks, mediaById)) return []
  if (await hasAudioContent(composition)) return []
  const warning: HeadlessRenderWarning = {
    code: 'NO_AUDIO_IN_MIX',
    message:
      'Composition contains items with audio, but the final mix has zero audible segments — the output file will have NO audio track',
  }
  log.warn(warning.message)
  if (strict) {
    throw new Error(`Strict validation failed (render): ${warning.code}: ${warning.message}`)
  }
  return [warning]
}

/** Merge caller findings with source-overrun checks and report them. */
function runLoadValidation(
  input: HeadlessTimelineInput,
  items: readonly TimelineItem[],
  compositions: readonly SubComposition[] | undefined,
  fps: number,
  mediaById: Map<string, MediaMetadata>,
  gpuAvailable: boolean,
): HeadlessRenderWarning[] {
  const validationWarnings = [
    ...(input.validationWarnings ?? []),
    ...sourceRangeWarnings(items, compositions, mediaById, fps),
    ...transitionWarnings(input.transitions, items, { gpuAvailable }),
    ...transformParentWarnings(items),
  ]
  reportValidationWarnings(validationWarnings, input.strict, 'render')
  return validationWarnings
}

/** Log every validation warning; in strict mode abort before any rendering. */
function reportValidationWarnings(
  warnings: HeadlessRenderWarning[],
  strict: boolean | undefined,
  context: string,
): void {
  for (const w of warnings) {
    log.warn(`[validation] ${w.message}`, { code: w.code, ...w.details })
  }
  if (strict && warnings.length > 0) {
    throw new Error(
      `Strict validation failed (${context}): ${warnings.length} warning(s) — ` +
        warnings.map((w) => `${w.code}: ${w.message}`).join('; '),
    )
  }
}

type ProgressSink = (progress: RenderProgress) => void

function reportProgress(progress: RenderProgress): void {
  const sink = (globalThis as unknown as { __freecutProgress?: ProgressSink }).__freecutProgress
  if (!sink) return
  try {
    sink(progress)
  } catch {
    // The driver-side binding may be torn down mid-render; ignore.
  }
}

/**
 * Register media URLs so resolveMediaUrls() + the engine's sub-comp media
 * lookup (blobUrlManager.get) resolve to them. We register the URL WITHOUT
 * downloading the bytes: mediabunny then reads via UrlSource (HTTP Range),
 * so large clips stream instead of being held fully in memory.
 */
function registerMediaUrls(media: HeadlessMediaSource[] | undefined): void {
  if (!media?.length) return
  for (const { mediaId, url } of media) {
    if (blobUrlManager.get(mediaId)) continue
    blobUrlManager.registerUrl(mediaId, url)
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Defer revoke so the browser/Playwright has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

function defaultFileName(settings: ClientExportSettings): string {
  return `freecut-export.${settings.container}`
}

function effectiveFileName(requested: string | undefined, settings: ClientExportSettings): string {
  if (!requested) return defaultFileName(settings)
  return `${requested.replace(/\.[^./\\]+$/, '')}.${settings.container}`
}

let webGpuAvailable: Promise<boolean> | null = null
/** Memoised: validation, the GPU assert and the render path all ask the same question. */
function detectWebGpuOnce(): Promise<boolean> {
  webGpuAvailable ??= detectWebGpu()
  return webGpuAvailable
}

async function detectWebGpu(): Promise<boolean> {
  try {
    if (!('gpu' in navigator) || !navigator.gpu) return false
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return false
    // An adapter is not enough: device acquisition is what actually fails on
    // headless/software stacks, and reporting "GPU available" on the strength of
    // an adapter alone would suppress warnings for presets that then fall back.
    const device = await adapter.requestDevice()
    if (!device) return false
    device.destroy()
    return true
  } catch {
    return false
  }
}

const hasEnabledEffects = (items: Array<{ effects?: ItemEffect[] }>): boolean =>
  items.some((item) => item.effects?.some((effect) => effect.enabled))

/** Whether the render needs WebGPU: GPU effects have no Canvas2D fallback. */
function compositionUsesGpuEffects(
  composition: CompositionInputProps,
  compositions: SubComposition[],
): boolean {
  const topLevel = (composition.tracks ?? []).flatMap((track) => track.items ?? [])
  if (hasEnabledEffects(topLevel)) return true
  return compositions.some((comp) => hasEnabledEffects(comp.items ?? []))
}

/**
 * Verify WebGPU is available when the project needs it. GPU effects can't fall
 * back to Canvas2D, so rendering them without WebGPU would silently drop them —
 * fail loudly instead. Transitions DO have a Canvas2D fallback, so a missing
 * GPU there is only a warning.
 */
async function assertGpuForComposition(
  composition: CompositionInputProps,
  compositions: SubComposition[],
): Promise<HeadlessRenderWarning[]> {
  const needsGpuEffects = compositionUsesGpuEffects(composition, compositions)
  const hasTransitions = (composition.transitions?.length ?? 0) > 0
  if (!needsGpuEffects && !hasTransitions) return []

  const gpuAvailable = await detectWebGpu()
  if (gpuAvailable) return []

  if (needsGpuEffects) {
    throw new Error(
      'This project uses GPU effects but WebGPU is unavailable in this environment, ' +
        'so effects cannot render. Launch Chrome with --enable-unsafe-webgpu on a machine ' +
        'with a GPU (or SwiftShader/Vulkan in headless/Docker).',
    )
  }
  const warning: HeadlessRenderWarning = {
    code: 'WEBGPU_TRANSITION_FALLBACK',
    message: 'WebGPU unavailable; transitions will use the Canvas2D fallback',
  }
  log.warn(warning.message)
  return [warning]
}

/**
 * Ensure the requested video codec is actually encodable in this browser;
 * otherwise fall back the same way the in-app export does.
 */
async function adaptVideoSettings(
  requestedSettings: ClientExportSettings,
): Promise<{ settings: ClientExportSettings; warnings: HeadlessRenderWarning[] }> {
  const settings = structuredClone(requestedSettings)
  if (settings.mode === 'audio') return { settings, warnings: [] }
  const testOverride = (
    globalThis as unknown as {
      __freecutSupportedCodecsOverride?: Awaited<ReturnType<typeof getSupportedCodecs>>
    }
  ).__freecutSupportedCodecsOverride
  const supported =
    testOverride ??
    (await getSupportedCodecs({
      width: settings.resolution.width,
      height: settings.resolution.height,
      bitrate: settings.videoBitrate,
    }))
  if (supported.includes(settings.codec)) {
    settings.audioCodec = getDefaultAudioCodec(settings.container)
    return { settings, warnings: [] }
  }

  const container = settings.container as ClientVideoContainer
  const fallback =
    selectFallbackVideoCodec(supported, container) ?? selectFallbackVideoCodec(supported)
  if (!fallback) {
    throw new Error(
      `No supported video codec available (requested ${settings.codec}; browser supports: ${supported.join(', ') || 'none'})`,
    )
  }
  const requested = settings.codec
  const effectiveContainer = getPreferredContainerForCodec(fallback)
  const warning: HeadlessRenderWarning = {
    code: 'CODEC_FALLBACK',
    message: `Requested video codec ${requested} is unsupported; using ${fallback}/${effectiveContainer}`,
    details: { requestedCodec: requested, effectiveCodec: fallback, effectiveContainer },
  }
  log.warn(warning.message, {
    requested,
    fallback,
    container: effectiveContainer,
  })
  settings.codec = fallback
  settings.container = effectiveContainer
  settings.audioCodec = getDefaultAudioCodec(effectiveContainer)
  return { settings, warnings: [warning] }
}

async function renderTimeline(input: HeadlessTimelineInput): Promise<HeadlessRenderSummary> {
  const {
    tracks,
    items,
    transitions = [],
    fps,
    width,
    height,
    inPoint = null,
    outPoint = null,
    keyframes = [],
    backgroundColor,
    busAudioEq,
    masterBusDb,
    compositions = [],
    media,
    settings: requestedSettings,
  } = input

  log.info('Headless render starting', {
    mode: requestedSettings.mode,
    codec: requestedSettings.codec,
    container: requestedSettings.container,
    resolution: `${requestedSettings.resolution.width}x${requestedSettings.resolution.height}`,
    fps,
    tracks: tracks.length,
    items: items.length,
    compositions: compositions.length,
    media: media?.length ?? 0,
  })

  // Seed sub-compositions so the engine can resolve compound clips.
  useCompositionsStore.getState().setCompositions(compositions)

  // Register media URLs (range-streamed by mediabunny) so resolveMediaUrls()
  // and the engine's sub-comp media lookup resolve without the storage layer.
  registerMediaUrls(media)
  // Seed media metadata so codec lookups resolve (enables AC-3/E-AC-3 audio).
  seedMediaLibrary(media)

  const { settings, warnings } = await adaptVideoSettings(requestedSettings)

  // Load-time validation: caller-collected findings (project normalization)
  // plus source-overrun checks. Logged always; fatal before render in --strict.
  const mediaById = buildMediaMetadataMap(media)
  warnings.unshift(
    ...runLoadValidation(input, items, compositions, fps, mediaById, await detectWebGpuOnce()),
  )

  const composition: CompositionInputProps = convertTimelineToComposition(
    tracks,
    items,
    transitions,
    fps,
    width,
    height,
    inPoint,
    outPoint,
    keyframes,
    backgroundColor,
    busAudioEq,
    masterBusDb,
  )

  warnings.push(...(await prepareFonts(composition.tracks)))

  // Fail loudly if the project needs WebGPU (effects) but it isn't available.
  warnings.push(...(await assertGpuForComposition(composition, compositions)))

  // Resolve top-level media (mediaId -> seeded blob URL). Export never uses proxies.
  composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })

  // Silent-failure guard: items with audio present but zero audible segments in
  // the final mix is almost always an authoring/engine bug, not intent. (In
  // audio-only mode renderAudioOnly additionally throws on an empty mix.)
  warnings.push(...(await collectSilentMixWarnings(composition, mediaById, input.strict)))

  const result =
    settings.mode === 'audio'
      ? await renderAudioOnly({ settings, composition, onProgress: reportProgress })
      : await renderComposition({ settings, composition, onProgress: reportProgress })

  const fileName = effectiveFileName(input.outputFileName, settings)
  triggerDownload(result.blob, fileName)

  log.info('Headless render complete', {
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    durationSeconds: result.duration,
    fileName,
  })

  return {
    ok: true,
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    durationSeconds: result.duration,
    fileName,
    effectiveSettings: settings,
    warnings,
  }
}

async function renderProject(input: HeadlessProjectInput): Promise<HeadlessRenderSummary> {
  const { project: rawProject, settings, media, renderWholeProject = true, outputFileName } = input
  const { project, warnings: projectWarnings } = migrateProject(rawProject)
  const timeline = project.timeline
  if (!timeline) {
    throw new Error('Project has no timeline to render')
  }

  const meta = project.metadata
  const hasExplicitRange = input.inPoint != null || input.outPoint != null
  const inPoint = hasExplicitRange
    ? (input.inPoint ?? null)
    : renderWholeProject
      ? null
      : (timeline.inPoint ?? null)
  const outPoint = hasExplicitRange
    ? (input.outPoint ?? null)
    : renderWholeProject
      ? null
      : (timeline.outPoint ?? null)

  return renderTimeline({
    tracks: (timeline.tracks ?? []) as unknown as TimelineTrack[],
    items: (timeline.items ?? []) as unknown as TimelineItem[],
    transitions: (timeline.transitions ?? []) as Transition[],
    fps: meta?.fps ?? 30,
    width: meta?.width ?? 1920,
    height: meta?.height ?? 1080,
    inPoint,
    outPoint,
    keyframes: (timeline.keyframes ?? []) as unknown as ItemKeyframes[],
    backgroundColor: meta?.backgroundColor,
    busAudioEq: timeline.busAudioEq,
    masterBusDb: timeline.masterBusDb,
    compositions: (timeline.compositions ?? []) as unknown as SubComposition[],
    media,
    settings,
    outputFileName,
    strict: input.strict,
    validationWarnings: projectWarningsToHeadless(projectWarnings),
  })
}

// ---------------------------------------------------------------------------
// Fast-iteration helpers: single-frame grab + layout inspection
// ---------------------------------------------------------------------------

/** Grab one frame from a Project as an image (default: full-res PNG). */
interface HeadlessFrameInput {
  project: Project
  media?: HeadlessMediaSource[]
  /** Project-frame index to render. Takes precedence over `atSeconds`. */
  frame?: number
  /** Time (seconds) to render; converted to a frame with the project fps. */
  atSeconds?: number
  /** Output size. Defaults to the project resolution (full quality). */
  width?: number
  height?: number
  format?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
  outputFileName?: string
  /** Fail before rendering if any validation warning was collected. */
  strict?: boolean
}

interface HeadlessFrameSummary {
  ok: true
  frame: number
  atSeconds: number
  width: number
  height: number
  format: string
  fileSize: number
  fileName: string
  /** Same diagnostic channel as a full render — a frame grab can degrade too. */
  warnings: HeadlessRenderWarning[]
}

/** Inspect the computed on-canvas layout (bounding boxes) at a frame. */
interface HeadlessLayoutInput {
  project: Project
  media?: HeadlessMediaSource[]
  frame?: number
  atSeconds?: number
  /** Fail if any validation warning was collected. */
  strict?: boolean
}

/** One styled sub-range of an inline-flowed line, in canvas coordinates. */
interface TextLayoutSpan {
  text: string
  x: number
  width: number
  color: string
}

interface TextLayoutLine {
  text: string
  /** Canvas-space left edge of the occupied line box. */
  x: number
  /** Canvas-space top of the line box. */
  y: number
  /** Canvas-space alphabetic baseline. */
  baseline: number
  /** Advance width incl. trailing letter-spacing. */
  width: number
  /** Visible ink width (excludes trailing letter-spacing). */
  inkWidth: number
  height: number
  color: string
  fontSize: number
  letterSpacing: number
  /** Present only for `spanLayout: 'inline'` items. */
  spans?: TextLayoutSpan[]
}

/**
 * True rendered geometry of a text item at the requested frame — the same
 * `layoutTextBlock` output the Canvas/GPU renderers draw from, mapped into
 * canvas coordinates. Lets callers position companion graphics (underlines,
 * plates) pixel-exactly instead of estimating glyph widths.
 */
interface TextLayoutInfo {
  /** The auto-expanded text box (canvas-space). */
  box: { x: number; y: number; width: number; height: number }
  lines: TextLayoutLine[]
  background?: { x: number; y: number; width: number; height: number; radius: number }
}

interface LayoutBox {
  id: string
  type: TimelineItem['type']
  trackId: string
  from: number
  durationInFrames: number
  /** Canvas-space top-left corner (px), origin at canvas top-left. */
  x: number
  y: number
  /** Bounding-box size (px). For text this is the auto-expanded text box. */
  width: number
  height: number
  opacity: number
  rotation: number
  cornerRadius: number
  /** Active at this frame, on a visible track, not fully transparent. */
  visible: boolean
  /** Draw order (higher = composited on top). */
  z: number
  text?: string
  textAlign?: string
  verticalAlign?: string
  fontSize?: number
  textLayout?: TextLayoutInfo
}

interface HeadlessLayoutResult {
  frame: number
  atSeconds: number
  canvas: { width: number; height: number; fps: number }
  items: LayoutBox[]
  /** Font failures make the reported text boxes untrustworthy — say so. */
  warnings: HeadlessRenderWarning[]
}

interface MigratedTimelineView {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  compositions: SubComposition[]
  fps: number
  width: number
  height: number
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb?: number
  /** Non-fatal findings from project normalization (overlap repairs etc.). */
  projectWarnings: ProjectWarning[]
}

/** Migrate a raw project and extract the fields the composition builder needs. */
// Thin ??-default mapping; exercised end-to-end by the headless chrome contract suite
// fallow-ignore-next-line complexity
function extractTimeline(rawProject: Project): MigratedTimelineView {
  const { project, warnings: projectWarnings } = migrateProject(rawProject)
  const timeline = project.timeline
  if (!timeline) throw new Error('Project has no timeline')
  const meta = project.metadata
  return {
    projectWarnings,
    tracks: (timeline.tracks ?? []) as unknown as TimelineTrack[],
    items: (timeline.items ?? []) as unknown as TimelineItem[],
    transitions: (timeline.transitions ?? []) as Transition[],
    keyframes: (timeline.keyframes ?? []) as unknown as ItemKeyframes[],
    compositions: (timeline.compositions ?? []) as unknown as SubComposition[],
    fps: meta?.fps ?? 30,
    width: meta?.width ?? 1920,
    height: meta?.height ?? 1080,
    backgroundColor: meta?.backgroundColor,
    busAudioEq: timeline.busAudioEq,
    masterBusDb: timeline.masterBusDb,
  }
}

function resolveTargetFrame(
  view: MigratedTimelineView,
  input: HeadlessFrameInput | HeadlessLayoutInput,
): number {
  if (input.frame != null) return Math.max(0, Math.round(input.frame))
  return Math.max(0, Math.round((input.atSeconds ?? 0) * view.fps))
}

function buildComposition(view: MigratedTimelineView): CompositionInputProps {
  return convertTimelineToComposition(
    view.tracks,
    view.items,
    view.transitions,
    view.fps,
    view.width,
    view.height,
    null,
    null,
    view.keyframes,
    view.backgroundColor,
    view.busAudioEq,
    view.masterBusDb,
  )
}

/**
 * Render a single project frame straight to an image Blob (default: full-res
 * PNG). Much faster than encoding a short clip + extracting a frame with
 * ffmpeg: no muxer, no encoder, no audio pipeline — just one composited frame.
 */
// Browser-harness driver; exercised end-to-end by the headless chrome contract suite
// fallow-ignore-next-line complexity
async function renderFrame(input: HeadlessFrameInput): Promise<HeadlessFrameSummary> {
  const view = extractTimeline(input.project)
  const gpuAvailable = await detectWebGpuOnce()
  const frame = resolveTargetFrame(view, input)
  const validationWarnings = [
    ...projectWarningsToHeadless(view.projectWarnings),
    ...sourceRangeWarnings(
      view.items,
      view.compositions,
      buildMediaMetadataMap(input.media),
      view.fps,
    ),
    ...transitionWarnings(view.transitions, view.items, { gpuAvailable }),
    ...transformParentWarnings(view.items),
  ]
  reportValidationWarnings(validationWarnings, input.strict, 'frame')

  useCompositionsStore.getState().setCompositions(view.compositions)
  registerMediaUrls(input.media)
  seedMediaLibrary(input.media)

  const composition = buildComposition(view)
  // Same font gate as the full render — a single frame grab that quietly used the
  // fallback family would be indistinguishable from a correct one.
  const warnings = await prepareFonts(composition.tracks)
  await assertGpuForComposition(composition, view.compositions)
  composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })

  const outWidth = input.width ?? view.width
  const outHeight = input.height ?? view.height
  const format = input.format ?? 'image/png'
  const blob = await renderSingleFrame({
    composition,
    frame,
    width: outWidth,
    height: outHeight,
    format,
    quality: input.quality ?? 1,
  })
  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png'
  const fileName = input.outputFileName ?? `freecut-frame-${frame}.${ext}`
  triggerDownload(blob, fileName)

  log.info('Headless frame grab complete', {
    frame,
    width: outWidth,
    height: outHeight,
    format,
    fileSize: blob.size,
  })

  return {
    ok: true,
    frame,
    atSeconds: frame / view.fps,
    width: outWidth,
    height: outHeight,
    format,
    fileSize: blob.size,
    fileName,
    warnings: [...validationWarnings, ...warnings],
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

let layoutMeasureCtx: OffscreenCanvasRenderingContext2D | null | undefined
/** Shared 1×1 measuring context — same canvas measurer the render paths use. */
function getLayoutMeasureCtx(): OffscreenCanvasRenderingContext2D | null {
  if (layoutMeasureCtx === undefined) {
    layoutMeasureCtx = new OffscreenCanvas(1, 1).getContext('2d')
  }
  return layoutMeasureCtx
}

/**
 * Dry-run the exact text layout the renderers draw from, mapped to canvas
 * coordinates. Mirrors the render path: resolve animated text properties,
 * auto-expand the box (baselines depend on box height for middle/bottom
 * vertical align), then `layoutTextBlock`.
 */
function computeTextLayout(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: { width: number; height: number; fps: number },
  transform: ReturnType<typeof getAnimatedTransform>,
): { textLayout: TextLayoutInfo; expanded: { width: number; height: number } } | null {
  const ctx = getLayoutMeasureCtx()
  if (!ctx) return null
  const resolvedItem = resolveAnimatedTextItem(item, itemKeyframes, frame - item.from, canvas)
  const expanded = expandTextTransformToFitContent(resolvedItem, transform)
  const left = canvas.width / 2 + expanded.x - expanded.width / 2
  const top = canvas.height / 2 + expanded.y - expanded.height / 2
  const block = layoutTextBlock(
    resolvedItem,
    expanded.width,
    expanded.height,
    createCanvasTextMeasurer(ctx),
  )
  return {
    expanded: { width: expanded.width, height: expanded.height },
    textLayout: {
      box: { x: left, y: top, width: expanded.width, height: expanded.height },
      lines: block.lines.map((line) => ({
        text: line.text,
        x: left + line.startX,
        y: top + line.top,
        baseline: top + line.baselineY,
        width: line.width,
        inkWidth: lineInkWidth(line),
        height: line.lineHeightPx,
        color: line.color,
        fontSize: line.fontSize,
        letterSpacing: line.letterSpacing,
        ...(line.runs
          ? {
              spans: line.runs.map((run) => ({
                text: run.text,
                x: left + line.startX + run.offsetX,
                width: run.width,
                color: run.color,
              })),
            }
          : {}),
      })),
      ...(block.background
        ? {
            background: {
              x: left + block.background.x,
              y: top + block.background.y,
              width: block.background.width,
              height: block.background.height,
              radius: block.background.radius,
            },
          }
        : {}),
    },
  }
}

/**
 * Dump the computed on-canvas bounding box of every visible item at a frame,
 * WITHOUT rendering. Reuses the exact transform resolver the export path uses
 * (`getAnimatedTransform`), so the coordinates match what a render would draw —
 * letting a caller verify positioning without a render round-trip.
 */
// Browser-harness driver; exercised end-to-end by the headless chrome contract suite
// fallow-ignore-next-line complexity
async function dumpLayout(input: HeadlessLayoutInput): Promise<HeadlessLayoutResult> {
  const view = extractTimeline(input.project)
  const gpuAvailable = await detectWebGpuOnce()
  const frame = resolveTargetFrame(view, input)
  const validationWarnings = [
    ...projectWarningsToHeadless(view.projectWarnings),
    ...sourceRangeWarnings(
      view.items,
      view.compositions,
      buildMediaMetadataMap(input.media),
      view.fps,
    ),
    ...transitionWarnings(view.transitions, view.items, { gpuAvailable }),
    ...transformParentWarnings(view.items),
  ]
  reportValidationWarnings(validationWarnings, input.strict, 'layout')

  // Source dimensions (video/image) feed the fit-to-canvas default, so seed the
  // media store. No blob URLs / GPU needed — this is pure transform math.
  useCompositionsStore.getState().setCompositions(view.compositions)
  seedMediaLibrary(input.media)

  const composition = buildComposition(view)

  // Text boxes are NOT pure math: the transform resolver runs text items through
  // expandTextTransformToFitContent, which measures with a real canvas 2D context.
  // Without the same font gate the render path uses, the boxes reported here are
  // fallback-font measurements and silently disagree with what /frame draws.
  const warnings = await prepareFonts(composition.tracks)
  const canvas = { width: view.width, height: view.height, fps: view.fps }
  const keyframesMap = buildKeyframesMap(composition.keyframes)
  // Text geometry must be measured with the REAL fonts — without this every
  // width/wrap point comes from Chrome's fallback sans-serif.
  await ensureFontsLoaded(collectVisibleTextFontFamilies(composition.tracks), HEADLESS_FONT_WEIGHTS)

  // Track visibility comes from the SAME resolver the render path uses, so a
  // soloed track set makes `visible` agree with what a render would actually
  // draw. Reimplementing the rule here would drift: solo overrides `visible`
  // entirely (a soloed-but-hidden track still renders).
  const { visibleTrackIds } = resolveTrackRenderState(composition.tracks)

  // Transform-parented items (rigs) must report WORLD coordinates — the same
  // item index the export renderer uses to resolve parent chains.
  const expressionItemsById = new Map(
    composition.tracks.flatMap((track) =>
      (track.items ?? []).map((item) => [item.id, item] as const),
    ),
  )
  const layoutCanvas = {
    ...canvas,
    getExpressionItem: (itemId: string) => expressionItemsById.get(itemId),
    getExpressionKeyframes: (itemId: string) => keyframesMap.get(itemId),
  }

  const items: LayoutBox[] = []
  let z = 0
  // composition.tracks is already sorted descending by order (topmost track
  // last), matching the export draw order; within a track, items draw in array
  // order. Together these give the true z-stack (later = on top).
  for (const track of composition.tracks) {
    const trackVisible = visibleTrackIds.has(track.id)
    for (const item of track.items ?? []) {
      if (item.type === 'audio') continue
      const active = frame >= item.from && frame < item.from + item.durationInFrames
      if (!active) continue
      const t = getAnimatedTransform(item, keyframesMap.get(item.id), frame, layoutCanvas)
      const left = canvas.width / 2 + t.x - t.width / 2
      const top = canvas.height / 2 + t.y - t.height / 2
      const box: LayoutBox = {
        id: item.id,
        type: item.type,
        trackId: item.trackId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        x: round1(left),
        y: round1(top),
        width: round1(t.width),
        height: round1(t.height),
        opacity: Math.round(t.opacity * 1000) / 1000,
        rotation: t.rotation,
        cornerRadius: t.cornerRadius,
        visible: trackVisible && t.opacity > 0,
        z: z++,
      }
      if (item.type === 'text') {
        box.text = item.text
        box.textAlign = item.textAlign
        box.verticalAlign = item.verticalAlign
        box.fontSize = item.fontSize
        const measured = computeTextLayout(item, keyframesMap.get(item.id), frame, canvas, t)
        if (measured) {
          box.textLayout = measured.textLayout
          // Report the box the render actually uses (auto-expanded to fit content).
          box.x = round1(measured.textLayout.box.x)
          box.y = round1(measured.textLayout.box.y)
          box.width = round1(measured.expanded.width)
          box.height = round1(measured.expanded.height)
        }
      }
      items.push(box)
    }
  }

  return {
    frame,
    atSeconds: frame / view.fps,
    canvas,
    items,
    warnings: [...validationWarnings, ...warnings],
  }
}

interface FreecutHeadlessApi {
  ready: true
  renderTimeline: typeof renderTimeline
  renderProject: typeof renderProject
  renderFrame: typeof renderFrame
  dumpLayout: typeof dumpLayout
  editProject: typeof editProject
  normalizeProject: typeof normalizeProjectForHeadless
  probeMedia: typeof probeMedia
  createProject: typeof createProjectForHeadless
}

function createProjectForHeadless(input: {
  id?: string
  name: string
  description?: string
  width?: number
  height?: number
  fps?: number
  backgroundColor?: string
}): Project {
  const now = Date.now()
  const raw: Project = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    description: input.description ?? '',
    createdAt: now,
    updatedAt: now,
    duration: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: {
      width: input.width ?? DEFAULT_PROJECT_WIDTH,
      height: input.height ?? DEFAULT_PROJECT_HEIGHT,
      fps: input.fps ?? DEFAULT_PROJECT_FPS,
      ...(input.backgroundColor ? { backgroundColor: input.backgroundColor } : {}),
    },
  }
  const validated = validateProject(raw)
  if (!validated.success || !validated.data) throw new Error('Created project failed validation')
  return validated.data as Project
}

async function normalizeProjectForHeadless(raw: unknown): Promise<Project> {
  const validated = validateProject(raw)
  if (!validated.success || !validated.data) {
    throw new Error(
      `Project validation failed: ${validated.errors?.issues[0]?.message ?? 'invalid project'}`,
    )
  }
  const migrated = migrateProject(validated.data as Project).project
  const current = validateProject(migrated)
  if (!current.success || !current.data) throw new Error('Migrated project failed validation')
  return current.data as Project
}

async function probeMedia(input: { url: string; fileName: string; mimeType?: string }) {
  const response = await fetch(input.url)
  if (!response.ok) throw new Error(`Media fetch failed: HTTP ${response.status}`)
  if (!response.body || typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error('Streaming media probe requires OPFS and a readable response body')
  }
  const root = await navigator.storage.getDirectory()
  const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-160) || 'source.bin'
  const tempName = `.freecut-probe-${crypto.randomUUID()}-${safeName}`
  try {
    const handle = await root.getFileHandle(tempName, { create: true })
    const writable = await handle.createWritable()
    await response.body.pipeTo(writable)
    const file = await handle.getFile()
    const validation = await validateMediaFileContent(file)
    if (!validation.valid) throw new Error(validation.error ?? 'Media validation failed')
    const mimeType = input.mimeType || getMimeType(file)
    const { metadata } = await mediaProcessorService.processMedia(file, mimeType, {
      generateThumbnail: false,
      fastMetadata: true,
    })
    return { mimeType, metadata }
  } finally {
    await root.removeEntry(tempName).catch(() => {})
  }
}

declare global {
  interface Window {
    freecut: FreecutHeadlessApi
  }
}

window.freecut = {
  ready: true,
  renderTimeline,
  renderProject,
  renderFrame,
  dumpLayout,
  editProject,
  normalizeProject: normalizeProjectForHeadless,
  probeMedia,
  createProject: createProjectForHeadless,
}
log.info('Headless harness ready')
