import { describe, expect, it, vi } from 'vitest';
import { buildTools } from '../src/tools.mjs';
import { selectTab, BridgeError } from '../src/bridge.mjs';

/** Tiny in-memory bridge that records calls. */
function mockBridge() {
  const calls = [];
  return {
    calls,
    callApi: vi.fn(async (method, args = []) => {
      calls.push({ method, args });
      // Return something that reflects what the agent API would — enough
      // for schema round-trips.
      if (method === 'addTrack') return { id: 'track-1', name: 'V1', kind: args?.[0]?.kind ?? 'video', order: -1, locked: false, visible: true, muted: false, solo: false };
      if (method === 'addItem') return { id: 'item-1', type: args?.[0]?.type, trackId: args?.[0]?.trackId, from: args?.[0]?.from, durationInFrames: args?.[0]?.durationInFrames };
      if (method === 'getPlayback') return { currentFrame: 0, isPlaying: false, zoom: 1 };
      if (method === 'getTimeline') return { tracks: [], items: [], transitions: [], markers: [] };
      if (method === 'listProjects') return [{ id: 'project-abc', name: 'ABC' }];
      if (method === 'openProject') return { id: args[0], name: 'ABC' };
      if (method === 'setInOutPoints') return args[0];
      if (method === 'clearInOutPoints') return { inPoint: null, outPoint: null };
      if (method === 'renderExport') return { mimeType: 'video/mp4', fileSize: 4, duration: 1, extension: 'mp4', chunks: ['AAAA'] };
      return null;
    }),
  };
}

describe('tool definitions', () => {
  it('exposes the expected set of tools', () => {
    const tools = buildTools(mockBridge());
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'freecut_add_effect',
      'freecut_add_item',
      'freecut_add_marker',
      'freecut_add_track',
      'freecut_add_transition',
      'freecut_clear_in_out',
      'freecut_create_project',
      'freecut_export_snapshot',
      'freecut_get_playback',
      'freecut_get_project',
      'freecut_get_selection',
      'freecut_get_timeline',
      'freecut_import_media',
      'freecut_list_media',
      'freecut_list_projects',
      'freecut_load_snapshot',
      'freecut_move_item',
      'freecut_open_project',
      'freecut_pause',
      'freecut_play',
      'freecut_remove_effect',
      'freecut_remove_item',
      'freecut_remove_track',
      'freecut_remove_transition',
      'freecut_render_export',
      'freecut_render_project',
      'freecut_seek',
      'freecut_select_items',
      'freecut_set_in_out',
      'freecut_set_transform',
      'freecut_update_item',
      'freecut_workspace_status',
    ]);
  });

  it('every tool carries title + description + inputSchema', () => {
    const tools = buildTools(mockBridge());
    for (const t of tools) {
      expect(t.config.title, `${t.name} missing title`).toBeTypeOf('string');
      expect(t.config.description, `${t.name} missing description`).toBeTypeOf('string');
      expect(t.config.inputSchema, `${t.name} missing inputSchema`).toBeDefined();
      expect(t.handler, `${t.name} missing handler`).toBeInstanceOf(Function);
    }
  });

  it('add_track handler forwards a single object argument', async () => {
    const bridge = mockBridge();
    const addTrack = buildTools(bridge).find((t) => t.name === 'freecut_add_track');
    const out = await addTrack.handler({ kind: 'audio', name: 'music' });
    expect(bridge.calls).toEqual([{ method: 'addTrack', args: [{ kind: 'audio', name: 'music' }] }]);
    expect(out.structuredContent.kind).toBe('audio');
    expect(out.content[0].type).toBe('text');
  });

  it('seek handler forwards positional frame', async () => {
    const bridge = mockBridge();
    const seek = buildTools(bridge).find((t) => t.name === 'freecut_seek');
    await seek.handler({ frame: 42 });
    expect(bridge.calls).toEqual([{ method: 'seek', args: [42] }]);
  });

  it('set_in_out forwards a range object', async () => {
    const bridge = mockBridge();
    const setInOut = buildTools(bridge).find((t) => t.name === 'freecut_set_in_out');
    await setInOut.handler({ inPoint: 0, outPoint: 150 });
    expect(bridge.calls).toEqual([
      { method: 'setInOutPoints', args: [{ inPoint: 0, outPoint: 150 }] },
    ]);
  });

  it('add_effect reshapes args into (itemId, effectObject, enabled)', async () => {
    const bridge = mockBridge();
    const addEffect = buildTools(bridge).find((t) => t.name === 'freecut_add_effect');
    await addEffect.handler({
      itemId: 'item-7',
      gpuEffectType: 'gaussian-blur',
      params: { radius: 8 },
      enabled: true,
    });
    expect(bridge.calls).toEqual([
      {
        method: 'addEffect',
        args: [
          'item-7',
          { type: 'gpu-effect', gpuEffectType: 'gaussian-blur', params: { radius: 8 } },
          true,
        ],
      },
    ]);
  });

  it('move_item peels id out and forwards remainder as second arg', async () => {
    const bridge = mockBridge();
    const moveItem = buildTools(bridge).find((t) => t.name === 'freecut_move_item');
    await moveItem.handler({ id: 'item-1', from: 60, trackId: 'track-2' });
    expect(bridge.calls).toEqual([
      { method: 'moveItem', args: ['item-1', { from: 60, trackId: 'track-2' }] },
    ]);
  });

  it('render_export forwards a single options object', async () => {
    const bridge = mockBridge();
    const render = buildTools(bridge).find((t) => t.name === 'freecut_render_export');
    const out = await render.handler({ quality: 'medium', videoContainer: 'webm', maxBytes: 1024 });
    expect(bridge.calls).toEqual([
      { method: 'renderExport', args: [{ quality: 'medium', videoContainer: 'webm', maxBytes: 1024 }] },
    ]);
    expect(out.structuredContent.mimeType).toBe('video/mp4');
  });

  it('render_project opens a named project and renders with a range', async () => {
    const bridge = mockBridge();
    const render = buildTools(bridge).find((t) => t.name === 'freecut_render_project');
    const out = await render.handler({
      projectName: 'ABC',
      quality: 'low',
      videoContainer: 'mp4',
      range: { startSeconds: 0, durationSeconds: 5 },
    });
    expect(bridge.calls).toEqual([
      { method: 'listProjects', args: [] },
      { method: 'openProject', args: ['project-abc'] },
      {
        method: 'renderExport',
        args: [{ quality: 'low', videoContainer: 'mp4', range: { startSeconds: 0, durationSeconds: 5 } }],
      },
    ]);
    expect(out.structuredContent.duration).toBe(1);
  });
});

describe('selectTab', () => {
  const pages = [
    { type: 'page', url: 'https://other-site.com/' },
    { type: 'page', url: 'https://freecut.net/editor/abc' },
    { type: 'page', url: 'http://localhost:5173/' },
    { type: 'background_page', url: 'chrome-extension://whatever/' },
  ];

  it('prefers a freecut.net tab by default', () => {
    const t = selectTab(pages);
    expect(t.url).toMatch(/freecut\.net|localhost/);
  });

  it('matches by literal url substring', () => {
    const t = selectTab(pages, { url: 'localhost:5173' });
    expect(t.url).toBe('http://localhost:5173/');
  });

  it('throws if no tabs match and fallback not allowed', () => {
    const onlyOthers = [{ type: 'page', url: 'https://example.com/' }];
    expect(() => selectTab(onlyOthers)).toThrow(BridgeError);
  });

  it('any-tab falls back to the first page', () => {
    const onlyOthers = [{ type: 'page', url: 'https://example.com/' }];
    const t = selectTab(onlyOthers, { anyTab: true });
    expect(t.url).toBe('https://example.com/');
  });

  it('rejects when there are no page targets at all', () => {
    expect(() => selectTab([{ type: 'background_page', url: 'x' }], { anyTab: true })).toThrow(
      /no page targets/,
    );
  });
});
