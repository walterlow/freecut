/**
 * The editor tool catalog. Each tool validates with Zod (runtime) and carries a
 * hand-authored JSON Schema (`inputSchema`) for the prompt catalog + MCP. Tools
 * are clip-addressable: a `clips` arg takes refs ("c1", "c3") from the grounded
 * inventory, falling back to the current selection when omitted.
 */

import { z } from 'zod'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/editor/deps/timeline-utils'
import {
  useFillerRemovalDialogStore,
  useSilenceRemovalDialogStore,
} from '@/features/editor/deps/timeline-ui'
import { useProjectStore } from '@/features/editor/deps/projects'
import { searchTimelineTranscript } from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { TextItem, TimelineItem } from '@/types/timeline'
import type { EditorAgentTool, JsonSchema, ToolResult, ToolValidation } from './types'
import { buildClipRefs, resolveClipRefs, resolveItemRef, resolveTargetItems } from './clip-refs'

// --- factory ----------------------------------------------------------------

function makeValidate<S extends z.ZodType>(schema: S): (args: unknown) => ToolValidation {
  return (args) => {
    const result = schema.safeParse(args ?? {})
    if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
    const issue = result.error.issues[0]
    const path = issue?.path.join('.') || 'args'
    return { ok: false, error: `${path}: ${issue?.message ?? 'invalid'}` }
  }
}

function defineTool<S extends z.ZodType>(def: {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  readOnly?: boolean
  destructive?: boolean
  handoff?: boolean
  schema: S
  summarize: (args: z.infer<S>) => string
  execute: (args: z.infer<S>) => Promise<ToolResult> | ToolResult
}): EditorAgentTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    readOnly: def.readOnly ?? false,
    destructive: def.destructive ?? false,
    handoff: def.handoff ?? false,
    validate: makeValidate(def.schema),
    summarize: (args) => def.summarize(args as z.infer<S>),
    execute: (args) => def.execute(args as z.infer<S>),
  }
}

// --- shared schema fragments ------------------------------------------------

const CLIPS_PROP = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Clip refs like ["c1","c3"] from the timeline list. Omit to use the current selection.',
}

function objSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

const clipsField = z.array(z.string()).optional()

function getFps(): number {
  return useTimelineStore.getState().fps
}

function isMedia(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'audio'
}

// --- query tools ------------------------------------------------------------

const findClips = defineTool({
  name: 'find_clips',
  title: 'Find clips',
  description:
    'List clips on the timeline, optionally filtered by type or a label substring. Returns their refs so other tools can target them.',
  inputSchema: objSchema({
    query: {
      type: 'string',
      description: 'Case-insensitive substring to match against clip labels.',
    },
    type: {
      type: 'string',
      enum: ['video', 'audio', 'text', 'image', 'shape'],
      description: 'Restrict to one clip type.',
    },
  }),
  readOnly: true,
  schema: z.object({
    query: z.string().optional(),
    type: z.enum(['video', 'audio', 'text', 'image', 'shape']).optional(),
  }),
  summarize: (args) => `Find clips${args.type ? ` of type ${args.type}` : ''}`,
  execute: (args) => {
    const query = args.query?.toLowerCase()
    const matches = buildClipRefs().filter((clip) => {
      if (args.type && clip.type !== args.type) return false
      if (query && !clip.label.toLowerCase().includes(query)) return false
      return true
    })
    const summary =
      matches.map((clip) => `${clip.ref} ${clip.type} "${clip.label}"`).join('; ') ||
      'no matching clips'
    return { ok: true, message: `Found ${matches.length}: ${summary}`, data: matches }
  },
})

const searchTranscript = defineTool({
  name: 'search_transcript',
  title: 'Search spoken words',
  description:
    'Search what is SAID in the video/audio for a word or phrase. Returns matching clip refs and timecodes. Use this FIRST to locate content the user describes (e.g. "where I talk about pricing") before editing around it.',
  inputSchema: objSchema(
    { query: { type: 'string', description: 'A word or phrase spoken in the media.' } },
    ['query'],
  ),
  readOnly: true,
  schema: z.object({ query: z.string().min(1) }),
  summarize: (args) => `Search transcript for "${args.query}"`,
  execute: async (args) => {
    const matches = await searchTimelineTranscript(args.query)
    // Refresh ref maps so itemIds resolve to the refs the model already saw.
    buildClipRefs()
    if (matches.length === 0) {
      return { ok: true, message: `No spoken match for "${args.query}".`, data: [] }
    }
    const lines = matches.map((match) => {
      const ref = resolveItemRef(match.itemId) ?? '?'
      return `${ref} @${match.timelineSeconds.toFixed(1)}s "${match.snippet}"`
    })
    return { ok: true, message: `Found "${args.query}" in: ${lines.join('; ')}`, data: matches }
  },
})

const selectClips = defineTool({
  name: 'select_clips',
  title: 'Select clips',
  description: 'Select the given clips so later actions and the UI focus on them.',
  inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
  schema: z.object({ clips: z.array(z.string()).min(1) }),
  summarize: (args) => `Select ${args.clips.join(', ')}`,
  execute: (args) => {
    const ids = resolveClipRefs(args.clips)
    if (ids.length === 0) throw new Error('None of those clip refs exist.')
    useSelectionStore.getState().selectItems(ids)
    return { ok: true, message: `Selected ${ids.length} clip${ids.length === 1 ? '' : 's'}.` }
  },
})

const seekTo = defineTool({
  name: 'seek_to',
  title: 'Move playhead',
  description: 'Move the playhead to a time in seconds.',
  inputSchema: objSchema({ seconds: { type: 'number', minimum: 0 } }, ['seconds']),
  schema: z.object({ seconds: z.number().min(0) }),
  summarize: (args) => `Seek to ${args.seconds.toFixed(1)}s`,
  execute: (args) => {
    usePlaybackStore.getState().setCurrentFrame(Math.round(args.seconds * getFps()))
    return { ok: true, message: `Moved playhead to ${args.seconds.toFixed(1)}s.` }
  },
})

// --- creation tools ---------------------------------------------------------

const addTitle = defineTool({
  name: 'add_title',
  title: 'Add title',
  description: 'Add a text/title layer at the playhead (or at a given time).',
  inputSchema: objSchema(
    {
      text: { type: 'string', description: 'Title text.' },
      atSeconds: {
        type: 'number',
        minimum: 0,
        description: 'Start time; defaults to the playhead.',
      },
    },
    ['text'],
  ),
  schema: z.object({ text: z.string().min(1).max(300), atSeconds: z.number().min(0).optional() }),
  summarize: (args) => `Add title: "${args.text.slice(0, 40)}"`,
  execute: (args) => {
    const { tracks, items, fps, addItem } = useTimelineStore.getState()
    const { activeTrackId, selectItems } = useSelectionStore.getState()
    const currentProject = useProjectStore.getState().currentProject

    const targetTrack = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'text',
      preferredTrackId: activeTrackId,
    })
    if (!targetTrack) throw new Error('No available track for a text layer.')

    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)
    const proposed =
      args.atSeconds !== undefined
        ? Math.round(args.atSeconds * fps)
        : usePlaybackStore.getState().currentFrame
    const from =
      findNearestAvailableSpace(proposed, durationInFrames, targetTrack.id, items) ?? proposed

    const textItem: TextItem = createTextTemplateItem({
      placement: {
        trackId: targetTrack.id,
        from,
        durationInFrames,
        canvasWidth: currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
        canvasHeight: currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
        fps,
      },
      text: args.text,
    })

    addItem(textItem)
    if (useTimelineStore.getState().items.some((item) => item.id === textItem.id)) {
      selectItems([textItem.id])
    }
    return { ok: true, message: `Added a title "${args.text.slice(0, 40)}".` }
  },
})

// --- edit tools -------------------------------------------------------------

const split = defineTool({
  name: 'split',
  title: 'Split clips',
  description:
    'Split clips at a time (default playhead). Targets the given clips, else the selection, else all clips crossing that time.',
  inputSchema: objSchema({
    clips: CLIPS_PROP,
    atSeconds: { type: 'number', minimum: 0, description: 'Split time; defaults to the playhead.' },
  }),
  schema: z.object({ clips: clipsField, atSeconds: z.number().min(0).optional() }),
  summarize: (args) =>
    `Split at ${args.atSeconds !== undefined ? `${args.atSeconds.toFixed(1)}s` : 'the playhead'}`,
  execute: (args) => {
    const { items, splitItem } = useTimelineStore.getState()
    const frame =
      args.atSeconds !== undefined
        ? Math.round(args.atSeconds * getFps())
        : usePlaybackStore.getState().currentFrame

    const targeted = resolveTargetItems(args.clips)
    const pool = targeted.length > 0 ? targeted : items
    const crossing = pool.filter(
      (item) => frame > item.from && frame < item.from + item.durationInFrames,
    )
    if (crossing.length === 0) throw new Error('No clips cross that time to split.')

    for (const item of crossing) splitItem(item.id, frame)
    return {
      ok: true,
      message: `Split ${crossing.length} clip${crossing.length === 1 ? '' : 's'}.`,
    }
  },
})

const deleteClips = defineTool({
  name: 'delete_clips',
  title: 'Delete clips',
  description: 'Ripple-delete the given clips, closing the gaps so later clips shift back.',
  inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
  destructive: true,
  schema: z.object({ clips: z.array(z.string()).min(1) }),
  summarize: (args) => `Delete ${args.clips.join(', ')}`,
  execute: (args) => {
    const items = resolveTargetItems(args.clips)
    if (items.length === 0) throw new Error('None of those clip refs exist.')
    useTimelineStore.getState().rippleDeleteItems(items.map((item) => item.id))
    return { ok: true, message: `Deleted ${items.length} clip${items.length === 1 ? '' : 's'}.` }
  },
})

const setSpeed = defineTool({
  name: 'set_speed',
  title: 'Set speed',
  description: 'Change playback speed of video/audio clips. 1 = normal, 2 = double, 0.5 = half.',
  inputSchema: objSchema(
    { clips: CLIPS_PROP, speed: { type: 'number', minimum: 0.1, maximum: 10 } },
    ['speed'],
  ),
  schema: z.object({ clips: clipsField, speed: z.number().min(0.1).max(10) }),
  summarize: (args) => `Set speed to ${args.speed}x`,
  execute: (args) => {
    const { rateStretchItem } = useTimelineStore.getState()
    const media = resolveTargetItems(args.clips).filter(isMedia)
    if (media.length === 0) throw new Error('Select or name one or more video/audio clips.')
    for (const item of media) {
      const current = item.speed ?? 1
      const newDuration = Math.max(1, Math.round((item.durationInFrames * current) / args.speed))
      rateStretchItem(item.id, item.from, newDuration, args.speed)
    }
    return {
      ok: true,
      message: `Set ${media.length} clip${media.length === 1 ? '' : 's'} to ${args.speed}x.`,
    }
  },
})

const setVolume = defineTool({
  name: 'set_volume',
  title: 'Set volume',
  description: 'Set the volume of video/audio clips (0 = mute, 1 = full).',
  inputSchema: objSchema(
    { clips: CLIPS_PROP, volume: { type: 'number', minimum: 0, maximum: 1 } },
    ['volume'],
  ),
  schema: z.object({ clips: clipsField, volume: z.number().min(0).max(1) }),
  summarize: (args) => `Set volume to ${Math.round(args.volume * 100)}%`,
  execute: (args) => {
    const { updateItem } = useTimelineStore.getState()
    const media = resolveTargetItems(args.clips).filter(isMedia)
    if (media.length === 0) throw new Error('Select or name one or more video/audio clips.')
    for (const item of media) updateItem(item.id, { volume: args.volume })
    return {
      ok: true,
      message: `Set ${media.length} clip${media.length === 1 ? '' : 's'} to ${Math.round(args.volume * 100)}% volume.`,
    }
  },
})

const trimClip = defineTool({
  name: 'trim_clip',
  title: 'Trim clip',
  description: 'Trim seconds off the start or end of a single clip.',
  inputSchema: objSchema(
    {
      clip: { type: 'string', description: 'A single clip ref, e.g. "c2".' },
      side: { type: 'string', enum: ['start', 'end'] },
      seconds: { type: 'number', minimum: 0 },
    },
    ['clip', 'side', 'seconds'],
  ),
  schema: z.object({
    clip: z.string(),
    side: z.enum(['start', 'end']),
    seconds: z.number().min(0),
  }),
  summarize: (args) => `Trim ${args.seconds.toFixed(1)}s off the ${args.side} of ${args.clip}`,
  execute: (args) => {
    const [item] = resolveTargetItems([args.clip])
    if (!item) throw new Error(`Clip ${args.clip} does not exist.`)
    const frames = Math.round(args.seconds * getFps())
    if (frames <= 0) throw new Error('Trim amount must be greater than zero.')
    const { trimItemStart, trimItemEnd } = useTimelineStore.getState()
    if (args.side === 'start') trimItemStart(item.id, frames)
    else trimItemEnd(item.id, frames)
    return {
      ok: true,
      message: `Trimmed ${args.seconds.toFixed(1)}s off the ${args.side} of ${args.clip}.`,
    }
  },
})

const TRANSITION_TYPES = ['fade', 'dissolve', 'wipe', 'slide', 'flip', 'iris', 'pixelate'] as const

const addTransition = defineTool({
  name: 'add_transition',
  title: 'Add transition',
  description: 'Add a transition between exactly two adjacent clips on the same track.',
  inputSchema: objSchema({
    clips: {
      ...CLIPS_PROP,
      description: 'Exactly two adjacent clip refs. Omit to use the current selection.',
    },
    type: { type: 'string', enum: [...TRANSITION_TYPES] },
    durationSeconds: { type: 'number', minimum: 0.1, maximum: 5 },
  }),
  schema: z.object({
    clips: clipsField,
    type: z.enum(TRANSITION_TYPES).optional(),
    durationSeconds: z.number().min(0.1).max(5).optional(),
  }),
  summarize: (args) => `Add ${args.type ?? 'default'} transition`,
  execute: (args) => {
    const targets = resolveTargetItems(args.clips)
    if (targets.length !== 2) throw new Error('Name exactly two adjacent clips for a transition.')
    const [a, b] = targets as [TimelineItem, TimelineItem]
    if (a.trackId !== b.trackId) throw new Error('Both clips must be on the same track.')
    const [left, right] = a.from <= b.from ? [a, b] : [b, a]

    const { addTransition: add, fps } = useTimelineStore.getState()
    const durationInFrames = args.durationSeconds
      ? Math.max(1, Math.round(args.durationSeconds * fps))
      : undefined
    const ok = add(left.id, right.id, args.type as Parameters<typeof add>[2], durationInFrames)
    if (!ok) throw new Error('Could not add a transition between those clips.')
    return { ok: true, message: `Added a ${args.type ?? 'default'} transition.` }
  },
})

// --- review hand-offs -------------------------------------------------------

function cleanupTargetIds(clips: string[] | undefined): string[] {
  const targeted = resolveTargetItems(clips).filter(isMedia)
  if (targeted.length > 0) return targeted.map((item) => item.id)
  return useTimelineStore
    .getState()
    .items.filter(isMedia)
    .map((item) => item.id)
}

const removeSilence = defineTool({
  name: 'remove_silence',
  title: 'Remove silences',
  description:
    'Open the silence-removal review for the given clips (or all). The user previews and confirms the cuts.',
  inputSchema: objSchema({ clips: CLIPS_PROP }),
  handoff: true,
  schema: z.object({ clips: clipsField }),
  summarize: () => 'Review and remove silences',
  execute: (args) => {
    const itemIds = cleanupTargetIds(args.clips)
    if (itemIds.length === 0) throw new Error('There are no video or audio clips to analyze.')
    useSilenceRemovalDialogStore.getState().open({ itemIds })
    return { ok: true, message: 'Opened the silence-removal review.' }
  },
})

const removeFillers = defineTool({
  name: 'remove_fillers',
  title: 'Remove filler words',
  description:
    'Open the filler-word review (um, uh, like…) for the given clips (or all). The user previews and confirms.',
  inputSchema: objSchema({ clips: CLIPS_PROP }),
  handoff: true,
  schema: z.object({ clips: clipsField }),
  summarize: () => 'Review and remove filler words',
  execute: (args) => {
    const itemIds = cleanupTargetIds(args.clips)
    if (itemIds.length === 0) throw new Error('There are no video or audio clips to analyze.')
    useFillerRemovalDialogStore.getState().open({ itemIds })
    return { ok: true, message: 'Opened the filler-word review.' }
  },
})

export const EDITOR_TOOLS: readonly EditorAgentTool[] = [
  findClips,
  searchTranscript,
  selectClips,
  seekTo,
  addTitle,
  split,
  deleteClips,
  setSpeed,
  setVolume,
  trimClip,
  addTransition,
  removeSilence,
  removeFillers,
]
