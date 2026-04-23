#!/usr/bin/env node
/**
 * End-to-end dogfood script for the MCP bridge.
 *
 * Does what an MCP client would do — connects to a running Chrome,
 * locates the FreeCut tab, then runs a realistic sequence of agent-API
 * calls while printing each result. No MCP client required, so any
 * failures are in our own code (bridge, __FREECUT__ surface, or tool
 * handlers) rather than a client misconfiguration.
 *
 * Usage:
 *   node packages/mcp/scripts/dogfood.mjs               # default: localhost:9222, dev tab
 *   node packages/mcp/scripts/dogfood.mjs --port 9333
 *   node packages/mcp/scripts/dogfood.mjs --url freecut.net
 */

import { parseArgs } from 'node:util';
import { connectBridge } from '../src/bridge.mjs';
import { buildTools } from '../src/tools.mjs';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '9222' },
    url: { type: 'string' },
    'any-tab': { type: 'boolean', default: false },
    'keep-changes': { type: 'boolean', default: false },
  },
});

const port = Number.parseInt(values.port, 10);

function step(n, label) {
  process.stdout.write(`\n\x1b[36m[${n}]\x1b[0m \x1b[1m${label}\x1b[0m\n`);
}
function ok(msg) {
  process.stdout.write(`    \x1b[32m✓\x1b[0m ${msg}\n`);
}
function show(label, value) {
  const pretty = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const indented = pretty.split('\n').map((l) => `      ${l}`).join('\n');
  process.stdout.write(`    \x1b[2m${label}:\x1b[0m\n${indented}\n`);
}
function fail(msg, err) {
  process.stderr.write(`    \x1b[31m✗\x1b[0m ${msg}\n`);
  if (err) process.stderr.write(`      ${err.message ?? err}\n`);
  process.exit(1);
}

async function main() {
  step(1, `Connect to Chrome at ${values.host ?? '127.0.0.1/::1'}:${port}`);
  let bridge;
  try {
    bridge = await connectBridge({
      ...(values.host !== undefined && { host: values.host }),
      port,
      url: values.url,
      anyTab: values['any-tab'],
    });
  } catch (err) {
    fail('could not connect', err);
  }
  ok(`attached to tab ${bridge.target.id}`);
  show('url', bridge.target.url);

  step(2, 'Wait for window.__FREECUT__ to be installed');
  try {
    await bridge.waitForApi({ timeoutMs: 5000 });
    ok('__FREECUT__ is present');
  } catch (err) {
    fail('__FREECUT__ missing', err);
  }

  const tools = buildTools(bridge);
  const call = async (name, args = {}) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const result = await tool.handler(args);
    return result.structuredContent ?? result.content?.[0]?.text ?? null;
  };

  // Ids of anything we create — cleanup iterates these even if later
  // steps throw, so a failed run doesn't leave debris in the editor.
  const createdItemIds = [];
  const createdTrackIds = [];
  const createdProjectIds = [];

  try {
    await runSteps({ call, createdItemIds, createdTrackIds, createdProjectIds });
    process.stdout.write('\n\x1b[32mDogfood run succeeded.\x1b[0m\n');
  } finally {
    if (!values['keep-changes']) {
      step('x', 'Cleanup (always runs)');
      for (const id of createdItemIds) {
        try { await call('freecut_remove_item', { id }); ok(`removed item ${id}`); } catch (err) {
          process.stderr.write(`    \x1b[33m!\x1b[0m remove_item ${id} failed: ${err.message}\n`);
        }
      }
      for (const id of createdTrackIds) {
        try { await call('freecut_remove_track', { id }); ok(`removed track ${id}`); } catch (err) {
          process.stderr.write(`    \x1b[33m!\x1b[0m remove_track ${id} failed: ${err.message}\n`);
        }
      }
      if (createdProjectIds.length > 0) {
        // We intentionally do NOT auto-delete created projects; leaving
        // them behind makes the side effect visible and the user can
        // review or trash them themselves.
        ok(`kept ${createdProjectIds.length} project(s) for review: ${createdProjectIds.join(', ')}`);
      }
    }
    await bridge.close();
  }
}

async function runSteps({ call, createdItemIds, createdTrackIds, createdProjectIds }) {
  step(3, 'Check workspace status');
  const ws = await call('freecut_workspace_status');
  show('workspace', ws);
  if (!ws.granted) {
    fail('no workspace granted — click Choose folder in the tab once (File System Access needs a user gesture)');
  }

  step(4, 'Ensure a project is loaded');
  let project = await call('freecut_get_project');
  if (!project?.id) {
    show('state', 'no project loaded — creating one');
    const created = await call('freecut_create_project', {
      name: `Agent dogfood ${new Date().toISOString().slice(0, 19)}`,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    createdProjectIds.push(created.id);
    show('created project', created);
    project = await call('freecut_get_project');
  }
  show('project', project);

  step(5, 'Read timeline + playback');
  const timelineBefore = await call('freecut_get_timeline');
  show('tracks', timelineBefore.tracks.length);
  show('items', timelineBefore.items.length);
  show('playback', await call('freecut_get_playback'));

  step(6, 'Add a video track');
  let createdTrack;
  try {
    createdTrack = await call('freecut_add_track', { kind: 'video', name: 'Agent test' });
    createdTrackIds.push(createdTrack.id);
  } catch (err) {
    fail('addTrack threw', err);
  }
  show('created track', createdTrack);

  step(7, 'Add a text clip to the new track');
  let createdClip;
  try {
    createdClip = await call('freecut_add_item', {
      type: 'text',
      trackId: createdTrack.id,
      from: 0,
      durationInFrames: 90,
      text: 'Hello from the agent',
      color: '#ffffff',
      fontSize: 96,
    });
    createdItemIds.push(createdClip.id);
  } catch (err) {
    fail('addItem threw', err);
  }
  show('created item', createdClip);

  step(8, 'Apply a GPU effect to the text clip');
  try {
    const effect = await call('freecut_add_effect', {
      itemId: createdClip.id,
      gpuEffectType: 'gaussian-blur',
      params: { radius: 6 },
      enabled: true,
    });
    show('effect', effect);
  } catch (err) {
    fail('addEffect threw — gpu-effect id may be wrong', err);
  }

  step(9, 'Verify the timeline picked up both changes');
  const timelineAfter = await call('freecut_get_timeline');
  const foundTrack = timelineAfter.tracks.find((t) => t.id === createdTrack.id);
  const foundItem = timelineAfter.items.find((i) => i.id === createdClip.id);
  if (!foundTrack) fail('created track missing from getTimeline');
  if (!foundItem) fail('created item missing from getTimeline');
  ok('track + item both present in live timeline');

  step(10, 'Seek and read back the playhead');
  await call('freecut_seek', { frame: 30 });
  const pb = await call('freecut_get_playback');
  if (pb.currentFrame !== 30) fail(`seek didn't stick: currentFrame=${pb.currentFrame}`);
  ok(`playhead at frame ${pb.currentFrame}`);

  step(11, 'Export snapshot round-trip');
  try {
    const snap = await call('freecut_export_snapshot');
    if (!snap?.project) fail('exportSnapshot returned no project');
    ok(`snapshot ${snap.version}, project ${snap.project.id}, ${snap.mediaReferences.length} media refs`);
  } catch (err) {
    fail('exportSnapshot threw', err);
  }

}

main().catch((err) => {
  process.stderr.write(`\n\x1b[31munexpected failure:\x1b[0m ${err?.stack ?? err}\n`);
  process.exit(1);
});
