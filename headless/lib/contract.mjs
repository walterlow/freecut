import { z } from 'zod'

export const HEADLESS_API_VERSION = 1

const id = z.string().min(1)
const portableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const revisionSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const finite = z.number().finite()
const frame = z.number().int().nonnegative()
const positiveFrames = z.number().int().positive()
const projectObject = z.record(z.string(), z.unknown())
const params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))

const GPU_EFFECT_TYPES = [
  'gpu-ascii',
  'gpu-block-glitch',
  'gpu-blocks',
  'gpu-box-blur',
  'gpu-brightness',
  'gpu-bulge',
  'gpu-chroma-key',
  'gpu-color-glitch',
  'gpu-color-wheels',
  'gpu-contrast',
  'gpu-crt',
  'gpu-curves',
  'gpu-dither',
  'gpu-droste',
  'gpu-edge-detect',
  'gpu-exposure',
  'gpu-fluted-glass',
  'gpu-gaussian-blur',
  'gpu-glass-mosaic',
  'gpu-glow',
  'gpu-gradient-map',
  'gpu-grain',
  'gpu-grayscale',
  'gpu-halftone',
  'gpu-hue-shift',
  'gpu-ink',
  'gpu-invert',
  'gpu-kaleidoscope',
  'gpu-levels',
  'gpu-lut',
  'gpu-mirror',
  'gpu-motion-blur',
  'gpu-pixelate',
  'gpu-pixel-sort',
  'gpu-pixel-sort-hq',
  'gpu-posterize',
  'gpu-power-window',
  'gpu-radial-blur',
  'gpu-rgb-split',
  'gpu-ripple-glass',
  'gpu-saturation',
  'gpu-scanlines',
  'gpu-secondary-qualifier',
  'gpu-sepia',
  'gpu-sharpen',
  'gpu-temperature',
  'gpu-threshold',
  'gpu-trigger-wave',
  'gpu-twirl',
  'gpu-vhs',
  'gpu-vibrance',
  'gpu-vignette',
  'gpu-wave',
  'gpu-zoom-blur',
]

const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'backgroundRadius',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
]
const animatableProperty = z.union([
  z.enum(ANIMATABLE_PROPERTIES),
  z.string().regex(/^effect:[^:]+:[^:]+:[^:]+$/, 'invalid effect keyframe property'),
])
const easing = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
])
const transform = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: finite.positive().optional(),
    height: finite.positive().optional(),
    anchorX: finite.optional(),
    anchorY: finite.optional(),
    rotation: finite.optional(),
    opacity: finite.min(0).max(1).optional(),
    cornerRadius: finite.nonnegative().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    aspectRatioLocked: z.boolean().optional(),
  })
  .strict()
const effect = z
  .object({
    type: z.literal('gpu-effect'),
    gpuEffectType: z.enum(GPU_EFFECT_TYPES),
    params: params.default({}),
  })
  .strict()
const audioEqCutSlope = z.union([z.literal(6), z.literal(12), z.literal(18), z.literal(24)])
const audioEq = z
  .object({
    enabled: z.boolean().optional(),
    outputGainDb: finite.optional(),
    band1Enabled: z.boolean().optional(),
    band1Type: z.enum(['low-shelf', 'peaking', 'high-shelf', 'high-pass']).optional(),
    band1FrequencyHz: finite.optional(),
    band1GainDb: finite.optional(),
    band1Q: finite.optional(),
    band1SlopeDbPerOct: audioEqCutSlope.optional(),
    lowCutEnabled: z.boolean().optional(),
    lowCutFrequencyHz: finite.optional(),
    lowCutSlopeDbPerOct: audioEqCutSlope.optional(),
    lowEnabled: z.boolean().optional(),
    lowType: z.enum(['low-shelf', 'peaking', 'high-shelf', 'notch']).optional(),
    lowGainDb: finite.optional(),
    lowFrequencyHz: finite.optional(),
    lowQ: finite.optional(),
    lowMidEnabled: z.boolean().optional(),
    lowMidType: z.enum(['low-shelf', 'peaking', 'high-shelf', 'notch']).optional(),
    lowMidGainDb: finite.optional(),
    lowMidFrequencyHz: finite.optional(),
    lowMidQ: finite.optional(),
    midGainDb: finite.optional(),
    highMidEnabled: z.boolean().optional(),
    highMidType: z.enum(['low-shelf', 'peaking', 'high-shelf', 'notch']).optional(),
    highMidGainDb: finite.optional(),
    highMidFrequencyHz: finite.optional(),
    highMidQ: finite.optional(),
    highEnabled: z.boolean().optional(),
    highType: z.enum(['low-shelf', 'peaking', 'high-shelf', 'notch']).optional(),
    highGainDb: finite.optional(),
    highFrequencyHz: finite.optional(),
    highQ: finite.optional(),
    band6Enabled: z.boolean().optional(),
    band6Type: z.enum(['low-pass', 'low-shelf', 'peaking', 'high-shelf']).optional(),
    band6FrequencyHz: finite.optional(),
    band6GainDb: finite.optional(),
    band6Q: finite.optional(),
    band6SlopeDbPerOct: audioEqCutSlope.optional(),
    highCutEnabled: z.boolean().optional(),
    highCutFrequencyHz: finite.optional(),
    highCutSlopeDbPerOct: audioEqCutSlope.optional(),
  })
  .strict()
const trackUpdates = z
  .object({
    name: z.string().min(1).optional(),
    height: finite.positive().optional(),
    locked: z.boolean().optional(),
    syncLock: z.boolean().optional(),
    visible: z.boolean().optional(),
    muted: z.boolean().optional(),
    solo: z.boolean().optional(),
    volume: finite.optional(),
    color: z.string().optional(),
    order: finite.optional(),
    audioEq: audioEq.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'updates must not be empty')
const markerUpdates = z
  .object({
    frame: frame.optional(),
    color: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'updates must not be empty')

const opSchemas = [
  z
    .object({
      op: z.literal('addText'),
      id: id.optional(),
      text: z.string().optional(),
      from: frame.optional(),
      durationInFrames: positiveFrames.optional(),
      trackId: id.optional(),
      label: z.string().optional(),
      color: z.string().optional(),
      fontSize: finite.positive().optional(),
      fontFamily: z.string().min(1).optional(),
      fontWeight: z.enum(['medium', 'semibold', 'bold']).optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addItem'),
      item: z
        .object({
          type: id,
          trackId: id,
          from: frame,
          durationInFrames: positiveFrames,
          id: id.optional(),
        })
        .passthrough(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateItem'),
      id,
      updates: z
        .record(z.string(), z.unknown())
        .refine((value) => Object.keys(value).length > 0, 'updates must not be empty'),
    })
    .strict(),
  z.object({ op: z.literal('moveItem'), id, from: frame, trackId: id.optional() }).strict(),
  z.object({ op: z.literal('removeItems'), ids: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal('split'), id, frame }).strict(),
  z.object({ op: z.literal('trimStart'), id, amount: positiveFrames }).strict(),
  z.object({ op: z.literal('trimEnd'), id, amount: positiveFrames }).strict(),
  z
    .object({
      op: z.literal('addTransition'),
      leftClipId: id,
      rightClipId: id,
      type: z.literal('crossfade').optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addTrack'),
      kind: z.enum(['video', 'audio']).optional(),
      order: finite.optional(),
    })
    .strict(),
  z.object({ op: z.literal('updateTrack'), id, updates: trackUpdates }).strict(),
  z.object({ op: z.literal('removeTrack'), id }).strict(),
  z
    .object({
      op: z.literal('addClip'),
      mediaId: id,
      from: frame.optional(),
      trackId: id.optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addKeyframe'),
      itemId: id,
      property: animatableProperty,
      frame,
      value: finite,
      easing: easing.optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeKeyframes'), itemId: id, property: animatableProperty }).strict(),
  z.union([
    z.object({ op: z.literal('addEffect'), itemId: id, effect }).strict(),
    z
      .object({
        op: z.literal('addEffect'),
        itemId: id,
        gpuEffectType: z.enum(GPU_EFFECT_TYPES),
        params: params.optional(),
      })
      .strict(),
  ]),
  z.object({ op: z.literal('removeEffect'), itemId: id, effectId: id }).strict(),
  z
    .object({
      op: z.literal('setTransform'),
      id,
      transform: transform.refine(
        (value) => Object.keys(value).length > 0,
        'transform must not be empty',
      ),
    })
    .strict(),
  z
    .object({
      op: z.literal('addMarker'),
      frame,
      color: z.string().optional(),
      label: z.string().optional(),
    })
    .strict(),
  z.object({ op: z.literal('updateMarker'), id, updates: markerUpdates }).strict(),
  z.object({ op: z.literal('removeMarker'), id }).strict(),
  z.object({ op: z.literal('setInPoint'), frame }).strict(),
  z.object({ op: z.literal('setOutPoint'), frame }).strict(),
  z.object({ op: z.literal('clearInOutPoints') }).strict(),
  z
    .object({
      op: z.literal('setMasterAudio'),
      masterBusDb: finite.optional(),
      busAudioEq: audioEq.nullable().optional(),
    })
    .strict()
    .refine(
      (value) => value.masterBusDb !== undefined || value.busAudioEq !== undefined,
      'master audio update must not be empty',
    ),
  z
    .object({
      op: z.literal('setProjectSettings'),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      duration: finite.nonnegative().optional(),
      width: z.number().int().min(320).max(7680).optional(),
      height: z.number().int().min(240).max(4320).optional(),
      fps: z.number().int().min(1).max(240).optional(),
      backgroundColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
    })
    .strict()
    .refine(
      (value) => Object.keys(value).some((key) => key !== 'op'),
      'project settings update must not be empty',
    ),
]

export const EDIT_OPERATION_NAMES = [
  'addText',
  'addItem',
  'updateItem',
  'moveItem',
  'removeItems',
  'split',
  'trimStart',
  'trimEnd',
  'addTransition',
  'addTrack',
  'updateTrack',
  'removeTrack',
  'addClip',
  'addKeyframe',
  'removeKeyframes',
  'addEffect',
  'removeEffect',
  'setTransform',
  'addMarker',
  'updateMarker',
  'removeMarker',
  'setInPoint',
  'setOutPoint',
  'clearInOutPoints',
  'setMasterAudio',
  'setProjectSettings',
]
const EDIT_OPERATION_DESCRIPTIONS = Object.fromEntries(
  EDIT_OPERATION_NAMES.map((name) => [name, samplesDescription(name)]),
)

function samplesDescription(name) {
  const descriptions = {
    addText: 'Add a text item',
    addItem: 'Add a complete timeline item',
    updateItem: 'Update an existing item',
    moveItem: 'Move an existing item',
    removeItems: 'Remove existing items atomically',
    split: 'Split an item at a frame',
    trimStart: 'Trim frames from an item start',
    trimEnd: 'Trim frames from an item end',
    addTransition: 'Add a transition between clips',
    addTrack: 'Add a video or audio track',
    updateTrack: 'Update an existing timeline track',
    removeTrack: 'Remove an existing timeline track',
    addClip: 'Add workspace media as a clip',
    addKeyframe: 'Add a property keyframe',
    removeKeyframes: 'Remove keyframes for a property',
    addEffect: 'Add a registered GPU effect',
    removeEffect: 'Remove an existing item effect',
    setTransform: 'Update an item transform',
    addMarker: 'Add a project marker',
    updateMarker: 'Update a project marker',
    removeMarker: 'Remove a project marker',
    setInPoint: 'Set the project in point',
    setOutPoint: 'Set the project out point',
    clearInOutPoints: 'Clear the project in and out points',
    setMasterAudio: 'Update master audio settings',
    setProjectSettings: 'Update project metadata and settings',
  }
  return descriptions[name]
}
export const editOpSchema = z.union(opSchemas)
export const editRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    ops: z.array(editOpSchema).min(1),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const projectCreateRequestSchema = z
  .object({
    id: portableIdSchema.optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    width: z.number().int().min(320).max(7680).optional(),
    height: z.number().int().min(240).max(4320).optional(),
    fps: z.number().int().min(1).max(240).optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  })
  .strict()

const lifecycleTimelineSchema = z
  .object({
    tracks: z.array(z.unknown()),
    items: z.array(z.unknown()),
  })
  .passthrough()

const lifecycleProjectSchema = z
  .object({
    id: portableIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    duration: z.number().finite().nonnegative(),
    schemaVersion: z.number().int().positive().optional(),
    thumbnail: z.string().optional(),
    thumbnailId: z.string().optional(),
    rootFolderName: z.string().optional(),
    metadata: z
      .object({
        width: z.number().int().min(320).max(7680),
        height: z.number().int().min(240).max(4320),
        fps: z.number().int().min(1).max(240),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .strict(),
    timeline: lifecycleTimelineSchema.optional(),
  })
  .strict()

export const projectSaveRequestSchema = z
  .object({
    project: lifecycleProjectSchema,
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const projectUpdateRequestSchema = z
  .object({
    updates: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(240).max(4320).optional(),
        fps: z.number().int().min(1).max(240).optional(),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, 'updates must not be empty'),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedRevision) || v.force === true, {
    message: 'expectedRevision is required unless force is true',
    path: ['expectedRevision'],
  })

export const lifecycleEditRequestSchema = z
  .object({
    ops: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const callers = new Set()
    const referenceFields = new Set([
      'id',
      'ids',
      'itemId',
      'trackId',
      'leftClipId',
      'rightClipId',
      'effectId',
      'mediaId',
    ])
    for (let index = 0; index < value.ops.length; index++) {
      const callerId = value.ops[index]?.callerId
      if (typeof callerId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId is required and invalid',
          path: ['ops', index, 'callerId'],
        })
      } else if (callers.has(callerId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'callerId must be unique',
          path: ['ops', index, 'callerId'],
        })
      }
      const validateRefs = (input, field, path = []) => {
        if (Array.isArray(input)) {
          input.forEach((entry, itemIndex) => validateRefs(entry, field, [...path, itemIndex]))
        } else if (input && typeof input === 'object') {
          if ('$ref' in input) {
            const keys = Object.keys(input)
            const ref = input.$ref
            const match =
              typeof ref === 'string' ? /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref) : null
            if (
              keys.length !== 1 ||
              !referenceFields.has(field) ||
              !match ||
              !callers.has(match[1])
            ) {
              ctx.addIssue({
                code: 'custom',
                message: 'reference must target a prior callerId from an ID-valued field',
                path: ['ops', index, ...path],
              })
            }
            return
          }
          for (const [key, entry] of Object.entries(input)) validateRefs(entry, key, [...path, key])
        }
      }
      validateRefs(value.ops[index], undefined)
      const normalizeRefs = (input) => {
        if (Array.isArray(input)) return input.map(normalizeRefs)
        if (input && typeof input === 'object') {
          if (Object.keys(input).length === 1 && typeof input.$ref === 'string')
            return 'reference-id'
          return Object.fromEntries(
            Object.entries(input).map(([key, entry]) => [key, normalizeRefs(entry)]),
          )
        }
        return input
      }
      const { callerId: _callerId, ...wireOp } = value.ops[index]
      const parsed = editOpSchema.safeParse(normalizeRefs(wireOp))
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: ['ops', index, ...issue.path] })
      }
      if (typeof callerId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(callerId))
        callers.add(callerId)
    }
    if (value.persist && !value.expectedRevision && value.force !== true) {
      ctx.addIssue({
        code: 'custom',
        message: 'expectedRevision is required for persisted edits unless force is true',
        path: ['expectedRevision'],
      })
    }
  })

export const mediaProbeRequestSchema = z
  .object({
    persist: z.boolean().optional(),
    expectedRevision: revisionSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.persist || Boolean(value.expectedRevision) || value.force === true, {
    message: 'expectedRevision is required for persisted probes unless force is true',
    path: ['expectedRevision'],
  })

const RENDER_OPTIONS = {
  codecs: ['h264', 'h265', 'vp9', 'vp8', 'av1'],
  containers: ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a'],
  qualities: ['low', 'medium', 'high', 'ultra'],
}
export const renderRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    out: id.optional(),
    codec: z.enum(RENDER_OPTIONS.codecs).optional(),
    container: z.enum(RENDER_OPTIONS.containers).optional(),
    resolution: z
      .string()
      .regex(/^(\d{1,5})x(\d{1,5})$/)
      .refine((value) => {
        const [w, h] = value.split('x').map(Number)
        return w >= 16 && h >= 16 && w <= 16384 && h <= 16384
      }, 'resolution dimensions must be between 16 and 16384')
      .optional(),
    fps: finite.min(1).max(240).optional(),
    quality: z.enum(RENDER_OPTIONS.qualities).optional(),
    inSec: finite.nonnegative().optional(),
    outSec: finite.positive().optional(),
    duration: finite.positive().optional(),
    audioOnly: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })
  .refine((v) => !(v.outSec !== undefined && v.duration !== undefined), {
    message: 'outSec and duration are mutually exclusive',
    path: ['outSec'],
  })
  .refine((v) => v.outSec === undefined || v.outSec > (v.inSec ?? 0), {
    message: 'outSec must be greater than inSec',
    path: ['outSec'],
  })
  .refine((v) => !v.audioOnly || !v.container || ['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audioOnly requires an audio container',
    path: ['container'],
  })
  .refine((v) => v.audioOnly || !v.container || !['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audio containers require audioOnly',
    path: ['container'],
  })

export function normalizeRenderInput(value) {
  const out = { ...value }
  if (out.in !== undefined) out.inSec = Number(out.in)
  if (out['out-sec'] !== undefined) out.outSec = Number(out['out-sec'])
  if (out['audio-only'] !== undefined) out.audioOnly = Boolean(out['audio-only'])
  delete out.in
  delete out['out-sec']
  delete out['audio-only']
  for (const key of ['fps', 'duration']) if (out[key] !== undefined) out[key] = Number(out[key])
  return out
}

export class ContractValidationError extends Error {
  constructor(message, fields) {
    super(message)
    this.name = 'ContractValidationError'
    this.code = 'VALIDATION_ERROR'
    this.fields = fields
  }
}

export function validate(schema, value) {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
    code: issue.code,
  }))
  throw new ContractValidationError('Request validation failed', fields)
}

export function capabilities() {
  return {
    apiVersion: HEADLESS_API_VERSION,
    operations: EDIT_OPERATION_NAMES,
    operationDescriptions: EDIT_OPERATION_DESCRIPTIONS,
    options: {
      ...RENDER_OPTIONS,
      gpuEffects: GPU_EFFECT_TYPES,
      animatableProperties: ANIMATABLE_PROPERTIES,
    },
    schemas: {
      render: z.toJSONSchema(renderRequestSchema, { target: 'draft-7' }),
      edit: z.toJSONSchema(editRequestSchema, { target: 'draft-7' }),
      projectCreate: z.toJSONSchema(projectCreateRequestSchema, { target: 'draft-7' }),
      projectSave: z.toJSONSchema(projectSaveRequestSchema, { target: 'draft-7' }),
      projectUpdate: z.toJSONSchema(projectUpdateRequestSchema, { target: 'draft-7' }),
      lifecycleEdit: z.toJSONSchema(lifecycleEditRequestSchema, { target: 'draft-7' }),
      mediaProbe: z.toJSONSchema(mediaProbeRequestSchema, { target: 'draft-7' }),
    },
    lifecycle: {
      routes: [
        'GET /v1/capabilities',
        'POST /v1/projects',
        'GET /v1/projects',
        'GET /v1/projects/:id',
        'PUT /v1/projects/:id',
        'PATCH /v1/projects/:id',
        'POST /v1/projects/:id/edit',
        'GET /v1/projects/:id/snapshot',
        'GET /v1/events',
        'GET /v1/media',
        'GET /v1/media/:id',
        'POST /v1/media/:id/probe',
        'POST /v1/render',
      ],
      httpMediaUpload: false,
      deleteProject: false,
      writerMode: 'exclusive',
      limits: {
        projectJsonBytes: 16 * 1024 * 1024,
        mediaMetadataBytes: 2 * 1024 * 1024,
        editOps: 1000,
        localMediaBytes: 20 * 1024 ** 3,
      },
      deprecatedRoutes: ['/capabilities', '/projects', '/render', '/edit'],
    },
  }
}
