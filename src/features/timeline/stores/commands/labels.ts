import type { TimelineCommand } from './types'

const TRANSFORM_COMMAND_TYPES = new Set(['UPDATE_TRANSFORM', 'UPDATE_TRANSFORMS'])

const TRANSFORM_OPERATION_LABELS: Record<string, (noun: string) => string> = {
  move: (noun) => `Move ${noun}`,
  resize: (noun) => `Resize ${noun}`,
  rotate: (noun) => `Rotate ${noun}`,
  opacity: (noun) => `Adjust opacity (${noun})`,
  corner_radius: (noun) => `Adjust corner radius (${noun})`,
}

const SIMPLE_COMMAND_LABELS: Record<string, string> = {
  SET_IN_POINT: 'Set In point',
  SET_OUT_POINT: 'Set Out point',
  CLEAR_IN_OUT_POINTS: 'Clear In/Out points',
  CLEAR_MARKERS: 'Clear markers',
  CLEAR_TIMELINE: 'Clear timeline',
  REMOVE_FILLER_WORDS: 'Remove filler words',
  MATCH_IMAGES_TO_AUDIO: 'Match images to audio',
  APPLY_AUDIO_DUCKING: 'Apply audio ducking',
  INSERT_AUDIOBOOK_SFX: 'Add audiobook sound effects',
}

function toTitleCaseWords(input: string): string {
  return input
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function readCount(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null

  if (typeof payload.count === 'number' && Number.isFinite(payload.count)) {
    return Math.max(1, Math.round(payload.count))
  }

  if (Array.isArray(payload.ids)) {
    return Math.max(1, payload.ids.length)
  }

  if (typeof payload.id === 'string' && payload.id.length > 0) {
    return 1
  }

  return null
}

function formatTransformLabel(command: TimelineCommand): string {
  const payload = command.payload
  const operation = typeof payload?.operation === 'string' ? payload.operation : 'transform'
  const count = readCount(payload)
  const noun = count === null || count === 1 ? 'item' : `${count} items`
  const formatter = TRANSFORM_OPERATION_LABELS[operation]

  return formatter ? formatter(noun) : `Transform ${noun}`
}

function getPayloadFields(payload: Record<string, unknown> | undefined): Set<string> {
  const fields = Array.isArray(payload?.fields)
    ? payload.fields.filter((field): field is string => typeof field === 'string')
    : []
  return new Set(fields)
}

function formatProjectMetadataLabel(command: TimelineCommand): string {
  const fields = getPayloadFields(command.payload)
  const resized = fields.has('width') || fields.has('height')

  if (fields.has('fps') && resized) return 'Resize canvas and change frame rate'
  if (resized) return 'Resize canvas'
  if (fields.has('fps')) return 'Change frame rate'
  if (fields.has('backgroundColor')) return 'Change canvas background'
  return 'Update project settings'
}

function formatCountedCommandLabel(command: TimelineCommand): string | null {
  const count = readCount(command.payload)
  if (command.type === 'APPLY_AUTO_KEYFRAME_OPERATIONS') {
    return count === null
      ? 'Auto-keyframe properties'
      : `Auto-keyframe ${count} ${count === 1 ? 'property' : 'properties'}`
  }

  if (command.type === 'APPLY_BENTO_LAYOUT') {
    return count === null
      ? 'Apply bento layout'
      : `Apply bento layout (${count} ${count === 1 ? 'item' : 'items'})`
  }

  return null
}

function formatFallbackCommandLabel(command: TimelineCommand): string {
  const count = readCount(command.payload)
  const base = toTitleCaseWords(command.type)
  return count !== null && count > 1 ? `${base} (${count})` : base
}

export function formatTimelineCommandLabel(command: TimelineCommand): string {
  if (TRANSFORM_COMMAND_TYPES.has(command.type)) return formatTransformLabel(command)
  if (command.type === 'UPDATE_PROJECT_METADATA') return formatProjectMetadataLabel(command)

  const countedLabel = formatCountedCommandLabel(command)
  return countedLabel ?? SIMPLE_COMMAND_LABELS[command.type] ?? formatFallbackCommandLabel(command)
}
