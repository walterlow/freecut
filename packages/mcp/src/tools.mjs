/**
 * MCP tool definitions. Each tool wraps a `window.__FREECUT__` method so
 * agents can drive the live editor with strongly-typed inputs.
 */

import { z } from 'zod';
import { readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as resolvePath, join, extname, dirname } from 'node:path';
import { serveFiles } from './file-server.mjs';

const MEDIA_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.jpg', '.jpeg', '.png', '.gif', '.webp']);

/**
 * Expand a list of paths and/or directories into concrete media file
 * paths. Directories are scanned non-recursively by default, filtered
 * to supported media extensions.
 */
function resolveMediaPaths(inputs, { recursive = false } = {}) {
  const out = [];
  for (const raw of inputs) {
    const abs = resolvePath(raw);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      throw new Error(`path does not exist: ${abs}`);
    }
    if (stats.isFile()) {
      out.push(abs);
      continue;
    }
    if (stats.isDirectory()) {
      const queue = [abs];
      while (queue.length > 0) {
        const dir = queue.shift();
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (recursive) queue.push(full);
            continue;
          }
          if (entry.isFile() && MEDIA_EXTS.has(extname(entry.name).toLowerCase())) {
            out.push(full);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Shape expected by McpServer.registerTool: a plain object of zod schemas
 * (the "raw shape" form, not a z.object()).
 */

const trackIdSchema = z.string().describe('Existing track id');
const itemIdSchema = z.string().describe('Existing timeline item id');

const transformSchema = {
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  flipHorizontal: z.boolean().optional(),
  flipVertical: z.boolean().optional(),
};

const gpuEffectSchema = {
  gpuEffectType: z.string().describe('Id from src/lib/gpu-effects/effects/* (e.g. gaussian-blur)'),
  params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
};

const renderRangeSchema = z.object({
  inFrame: z.number().int().min(0).optional(),
  outFrame: z.number().int().positive().optional(),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().positive().optional(),
  durationInFrames: z.number().int().positive().optional(),
  startSeconds: z.number().min(0).optional(),
  endSeconds: z.number().positive().optional(),
  durationSeconds: z.number().positive().optional(),
}).optional();

const renderOptionsSchema = {
  mode: z.enum(['video', 'audio']).default('video'),
  quality: z.enum(['low', 'medium', 'high', 'ultra']).default('high'),
  codec: z.enum(['h264', 'h265', 'vp8', 'vp9', 'av1', 'prores']).optional(),
  videoContainer: z.enum(['mp4', 'mov', 'webm', 'mkv']).optional(),
  audioContainer: z.enum(['mp3', 'aac', 'wav']).optional(),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  renderWholeProject: z.boolean().default(false),
  range: renderRangeSchema,
  maxBytes: z.number().int().positive().optional(),
  chunkSize: z.number().int().positive().optional(),
};

async function openProjectBySelector(bridge, { projectId, projectName }) {
  if (projectId) return bridge.callApi('openProject', [projectId]);
  if (!projectName) throw new Error('projectId or projectName is required');
  const projects = await bridge.callApi('listProjects');
  const match = projects.find((p) => p.name === projectName || p.id === projectName)
    ?? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
  if (!match) {
    throw new Error(`no project matched ${JSON.stringify(projectName)}`);
  }
  return bridge.callApi('openProject', [match.id]);
}

async function renderAndMaybeWrite(bridge, args) {
  const { outputPath, projectId, projectName, ...renderOptions } = args;
  const result = await bridge.callApi('renderExport', [renderOptions]);
  if (!outputPath) return result;

  const abs = resolvePath(outputPath);
  await mkdir(dirname(abs), { recursive: true });
  const bytes = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, 'base64')));
  await writeFile(abs, bytes);
  return {
    outputPath: abs,
    mimeType: result.mimeType,
    duration: result.duration,
    fileSize: result.fileSize,
    extension: result.extension,
    chunkEncoding: result.chunkEncoding,
    chunkCount: result.chunks.length,
  };
}

/**
 * Build the tool list. Each entry provides MCP config plus a handler that
 * calls into the bridge. Kept in a single array so we can register and
 * unit-test them uniformly.
 */
export function buildTools(bridge) {
  const call = (name, args = {}) => bridge.callApi(name, [args]);
  const callPositional = (name, args = []) => bridge.callApi(name, args);

  /** Wrap a value so it becomes MCP tool-result content. */
  const wrap = (value) => ({
    content: [{ type: 'text', text: value == null ? 'null' : JSON.stringify(value, null, 2) }],
    structuredContent: value ?? undefined,
  });

  return [
    {
      name: 'freecut_get_timeline',
      config: {
        title: 'Get timeline',
        description: 'Return tracks, items, transitions, and markers from the live editor.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('getTimeline')),
    },
    {
      name: 'freecut_get_playback',
      config: {
        title: 'Get playback state',
        description: 'Return current frame, isPlaying, and zoom level.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('getPlayback')),
    },
    {
      name: 'freecut_get_project',
      config: {
        title: 'Get project metadata',
        description: 'Return current project id, name, width, height, fps.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('getProjectMeta')),
    },
    {
      name: 'freecut_get_selection',
      config: {
        title: 'Get current selection',
        description: 'Return currently selected item/transition/marker ids.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('getSelection')),
    },

    // Playback
    {
      name: 'freecut_play',
      config: { title: 'Play', description: 'Start playback.', inputSchema: {} },
      handler: async () => wrap(await bridge.callApi('play')),
    },
    {
      name: 'freecut_pause',
      config: { title: 'Pause', description: 'Pause playback.', inputSchema: {} },
      handler: async () => wrap(await bridge.callApi('pause')),
    },
    {
      name: 'freecut_seek',
      config: {
        title: 'Seek',
        description: 'Move the playhead to an absolute frame (project fps).',
        inputSchema: { frame: z.number().int().min(0) },
      },
      handler: async ({ frame }) => wrap(await callPositional('seek', [frame])),
    },
    {
      name: 'freecut_set_in_out',
      config: {
        title: 'Set in/out points',
        description: 'Set the current timeline IO markers in project frames. outPoint is exclusive.',
        inputSchema: {
          inPoint: z.number().int().min(0),
          outPoint: z.number().int().positive(),
        },
      },
      handler: async ({ inPoint, outPoint }) =>
        wrap(await callPositional('setInOutPoints', [{ inPoint, outPoint }])),
    },
    {
      name: 'freecut_clear_in_out',
      config: {
        title: 'Clear in/out points',
        description: 'Clear the current timeline IO markers.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('clearInOutPoints')),
    },

    // Selection
    {
      name: 'freecut_select_items',
      config: {
        title: 'Select items',
        description: 'Replace the current item selection.',
        inputSchema: { ids: z.array(z.string()) },
      },
      handler: async ({ ids }) => wrap(await callPositional('selectItems', [ids])),
    },

    // Tracks
    {
      name: 'freecut_add_track',
      config: {
        title: 'Add track',
        description: 'Create a new video or audio track, returned with its id.',
        inputSchema: {
          kind: z.enum(['video', 'audio']).default('video'),
          name: z.string().optional(),
        },
      },
      handler: async (args) => wrap(await call('addTrack', args)),
    },
    {
      name: 'freecut_remove_track',
      config: {
        title: 'Remove track',
        description: 'Delete a track and its items.',
        inputSchema: { id: trackIdSchema },
      },
      handler: async ({ id }) => wrap(await callPositional('removeTrack', [id])),
    },

    // Items
    {
      name: 'freecut_add_item',
      config: {
        title: 'Add timeline item',
        description:
          'Append a new item to a track. Supports video/audio/image/text/shape/adjustment. ' +
          'Frames are project-fps. Returns the created item id.',
        inputSchema: {
          type: z.enum(['video', 'audio', 'image', 'text', 'shape', 'adjustment']),
          trackId: trackIdSchema,
          from: z.number().int().min(0),
          durationInFrames: z.number().int().positive(),
          label: z.string().optional(),
          mediaId: z.string().optional(),
          src: z.string().optional(),
          // text
          text: z.string().optional(),
          fontSize: z.number().optional(),
          fontFamily: z.string().optional(),
          color: z.string().optional(),
          // shape
          shapeType: z.string().optional(),
          fillColor: z.string().optional(),
          // media dims
          sourceWidth: z.number().optional(),
          sourceHeight: z.number().optional(),
          volume: z.number().optional(),
          transform: z.object(transformSchema).optional(),
        },
      },
      handler: async (args) => wrap(await call('addItem', args)),
    },
    {
      name: 'freecut_update_item',
      config: {
        title: 'Update item',
        description: 'Apply a partial update to an existing item.',
        inputSchema: {
          id: itemIdSchema,
          updates: z.record(z.string(), z.unknown()),
        },
      },
      handler: async ({ id, updates }) => wrap(await callPositional('updateItem', [id, updates])),
    },
    {
      name: 'freecut_move_item',
      config: {
        title: 'Move item',
        description: 'Move an item to a new start frame and/or different track.',
        inputSchema: {
          id: itemIdSchema,
          from: z.number().int().min(0).optional(),
          trackId: z.string().optional(),
        },
      },
      handler: async ({ id, ...rest }) => wrap(await callPositional('moveItem', [id, rest])),
    },
    {
      name: 'freecut_remove_item',
      config: {
        title: 'Remove item',
        description: 'Delete a timeline item.',
        inputSchema: { id: itemIdSchema },
      },
      handler: async ({ id }) => wrap(await callPositional('removeItem', [id])),
    },
    {
      name: 'freecut_set_transform',
      config: {
        title: 'Set item transform',
        description: 'Replace the transform (position/size/rotation/opacity) on an item.',
        inputSchema: {
          id: itemIdSchema,
          transform: z.object(transformSchema),
        },
      },
      handler: async ({ id, transform }) => wrap(await callPositional('setTransform', [id, transform])),
    },

    // Effects
    {
      name: 'freecut_add_effect',
      config: {
        title: 'Add GPU effect',
        description: 'Attach a GPU effect to an item. Effect ids live in src/lib/gpu-effects/effects.',
        inputSchema: {
          itemId: itemIdSchema,
          ...gpuEffectSchema,
          enabled: z.boolean().default(true),
        },
      },
      handler: async ({ itemId, gpuEffectType, params, enabled }) =>
        wrap(await callPositional('addEffect', [
          itemId,
          { type: 'gpu-effect', gpuEffectType, params },
          enabled,
        ])),
    },
    {
      name: 'freecut_remove_effect',
      config: {
        title: 'Remove effect',
        description: 'Remove an effect from an item.',
        inputSchema: {
          itemId: itemIdSchema,
          effectId: z.string(),
        },
      },
      handler: async ({ itemId, effectId }) =>
        wrap(await callPositional('removeEffect', [itemId, effectId])),
    },

    // Transitions
    {
      name: 'freecut_add_transition',
      config: {
        title: 'Add transition',
        description: 'Add a transition between two adjacent clips on the same track.',
        inputSchema: {
          leftClipId: z.string(),
          rightClipId: z.string(),
          durationInFrames: z.number().int().positive().optional(),
          presetId: z.string().optional(),
        },
      },
      handler: async (args) => wrap(await call('addTransition', args)),
    },
    {
      name: 'freecut_remove_transition',
      config: {
        title: 'Remove transition',
        description: 'Delete a transition by id.',
        inputSchema: { id: z.string() },
      },
      handler: async ({ id }) => wrap(await callPositional('removeTransition', [id])),
    },

    // Markers
    {
      name: 'freecut_add_marker',
      config: {
        title: 'Add marker',
        description: 'Place a marker at a frame.',
        inputSchema: {
          frame: z.number().int().min(0),
          label: z.string().optional(),
          color: z.string().optional(),
        },
      },
      handler: async (args) => wrap(await call('addMarker', args)),
    },

    // Media library
    {
      name: 'freecut_list_media',
      config: {
        title: 'List media library',
        description: 'Return every media item registered in the current workspace.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('listMedia')),
    },
    {
      name: 'freecut_import_media',
      config: {
        title: 'Import media from local paths',
        description:
          'Import one or more files (or every media file in a directory) from the local filesystem ' +
          'into the FreeCut media library. Node bridge serves files on 127.0.0.1 so the page can fetch ' +
          'them via importMediaFromUrl. Returns imported media metadata.',
        inputSchema: {
          paths: z.array(z.string()).min(1).describe('Absolute file or directory paths'),
          recursive: z.boolean().default(false).describe('Recurse into subdirectories when a directory is given'),
        },
      },
      handler: async ({ paths, recursive }) => {
        const files = resolveMediaPaths(paths, { recursive });
        if (files.length === 0) {
          throw new Error('no supported media files found at the given paths');
        }
        const server = await serveFiles(files);
        try {
          const imported = [];
          for (let i = 0; i < files.length; i++) {
            const url = server.urls[i];
            const result = await bridge.callApi('importMediaFromUrl', [url]);
            if (Array.isArray(result)) imported.push(...result);
          }
          return wrap({ imported, count: imported.length });
        } finally {
          await server.close().catch(() => {});
        }
      },
    },

    // Project lifecycle
    {
      name: 'freecut_list_projects',
      config: {
        title: 'List projects',
        description: 'List all projects in the current workspace.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('listProjects')),
    },
    {
      name: 'freecut_create_project',
      config: {
        title: 'Create project',
        description: 'Create a new project and open it in the editor.',
        inputSchema: {
          name: z.string().min(1).max(100),
          width: z.number().int().min(320).max(7680).default(1920),
          height: z.number().int().min(240).max(4320).default(1080),
          fps: z.number().int().min(1).max(240).default(30),
          description: z.string().max(500).optional(),
          backgroundColor: z.string().optional(),
        },
      },
      handler: async (args) => wrap(await call('createProject', args)),
    },
    {
      name: 'freecut_open_project',
      config: {
        title: 'Open project',
        description: 'Load a project by id and navigate to the editor.',
        inputSchema: { id: z.string() },
      },
      handler: async ({ id }) => wrap(await callPositional('openProject', [id])),
    },
    {
      name: 'freecut_workspace_status',
      config: {
        title: 'Workspace status',
        description: 'Check whether a workspace folder has been granted. Returns { granted, name? }.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('getWorkspaceStatus')),
    },
    {
      name: 'freecut_load_snapshot',
      config: {
        title: 'Load snapshot',
        description:
          'Import a project snapshot produced by @freecut/sdk or @freecut/cli. ' +
          'Input is a JSON string of the snapshot.',
        inputSchema: { snapshotJson: z.string() },
      },
      handler: async ({ snapshotJson }) => wrap(await callPositional('loadSnapshot', [snapshotJson])),
    },
    {
      name: 'freecut_export_snapshot',
      config: {
        title: 'Export snapshot',
        description: 'Return the current project as a snapshot JSON object.',
        inputSchema: {},
      },
      handler: async () => wrap(await bridge.callApi('exportSnapshot')),
    },
    {
      name: 'freecut_render_export',
      config: {
        title: 'Render export',
        description:
          'Render the loaded project in the browser and return base64 chunks. ' +
          'Intended for local bridges; use maxBytes to guard large payloads.',
        inputSchema: renderOptionsSchema,
      },
      handler: async (args) => wrap(await call('renderExport', args)),
    },
    {
      name: 'freecut_render_project',
      config: {
        title: 'Render project',
        description:
          'Open a workspace project by id or name, render it in-browser, and optionally write the output file from MCP.',
        inputSchema: {
          projectId: z.string().optional(),
          projectName: z.string().optional(),
          outputPath: z.string().optional(),
          ...renderOptionsSchema,
        },
      },
      handler: async (args) => {
        await openProjectBySelector(bridge, args);
        return wrap(await renderAndMaybeWrite(bridge, args));
      },
    },
  ];
}
