# `window.__FREECUT__` agent API

Stable, JSON-serializable automation surface for driving the live editor
from agents, userscripts, extensions, or MCP bridges.

## Activation

| Environment | Condition |
| --- | --- |
| Dev (`vite`) | Always on |
| Prod (`freecut.net`) | `?agent=1` in URL **or** `localStorage['freecut.agent'] = '1'` |

Installation fires a `freecut:agent-api-ready` event on `window`. The
user explicitly opts in on prod so drive-by pages can't read project
state.

## Workspace grant is a one-time manual step

FreeCut stores projects and media in a user-picked directory via the
File System Access API. Granting that folder requires a trusted user
gesture — no automation framework (Playwright, CDP, extensions,
MCP) can bypass this. Chrome, by design.

**What this means in practice:**

- First session: the user clicks "Choose folder" once.
- Subsequent sessions (same `--user-data-dir`): Chrome shows a compact
  permission bar that also needs one click.
- Fully unattended workflows (CI, serverless) are not possible on the
  live editor. The path for that is server-side rendering — see
  `docs/headless-render-plan.md`.

Always check `getWorkspaceStatus()` first so you can surface a clear
"please click Choose folder" prompt to the user instead of hitting
confusing store-empty errors.

## Typical agent session

```js
await window.__FREECUT__.ready();

// 1. Verify the human has granted a workspace.
const ws = await window.__FREECUT__.getWorkspaceStatus();
if (!ws.granted) throw new Error('ask user to click "Choose folder"');

// 2. Ensure a project is loaded — create one if not.
let project = await window.__FREECUT__.getProjectMeta();
if (!project.id) {
  project = await window.__FREECUT__.createProject({
    name: 'Agent session',
    width: 1920, height: 1080, fps: 30,
  });
  // createProject navigates to /editor/:id and waits for the editor to
  // finish mounting before resolving — subsequent mutations are safe.
}

// 3. Mutate.
const track = await window.__FREECUT__.addTrack({ kind: 'video' });
const clip = await window.__FREECUT__.addItem({
  type: 'text',
  trackId: track.id,
  from: 0,
  durationInFrames: 90,
  text: 'Hello, FreeCut',
  color: '#ffffff',
  fontSize: 120,
});
await window.__FREECUT__.addEffect(clip.id, {
  type: 'gpu-effect',
  gpuEffectType: 'gaussian-blur',
  params: { radius: 6 },
});

// 4. Observe.
const { tracks, items } = await window.__FREECUT__.getTimeline();
const unsubscribe = window.__FREECUT__.subscribe(() => {
  console.log('timeline changed');
});
```

## Surface

### Queries

| Method | Purpose |
| --- | --- |
| `version` | Static string — API semver |
| `ready()` | Waits for lazy store imports |
| `getPlayback()` | `{ currentFrame, isPlaying, previewZoom }` — `previewZoom` is `'auto'` or a number |
| `getTimeline()` | Tracks, items, transitions, markers, `inPoint`, `outPoint` |
| `getSelection()` | Item / transition / marker ids |
| `getProjectMeta()` | `{ id, name, width, height, fps }` — ids are `null` when no project loaded |
| `getWorkspaceStatus()` | `{ granted, name? }` |

### Project lifecycle

| Method | Purpose |
| --- | --- |
| `listProjects()` | Every project in the current workspace |
| `createProject({name, width?, height?, fps?, description?, backgroundColor?})` | Create + open; resolves after the editor has finished mounting |
| `openProject(id)` | Load an existing project and navigate to it |
| `loadSnapshot(json)` | Import an SDK/CLI-authored snapshot |
| `exportSnapshot()` | Dump the current project as a snapshot object |
| `renderExport(opts)` | Render the loaded project via the browser export engine and return base64 chunks |

`renderExport` accepts `{ mode, quality, codec, videoContainer, audioContainer,
resolution, renderWholeProject, range, maxBytes, chunkSize }`. `range` can use
frame fields (`inFrame`, `outFrame`, `startFrame`, `endFrame`,
`durationInFrames`) or seconds fields (`startSeconds`, `endSeconds`,
`durationSeconds`) and overrides timeline IO markers for that render only. It
is intended for local bridges such as `freecut render`; large exports should
use the browser UI unless the caller raises `maxBytes`.

### Playback / selection

`play()`, `pause()`, `seek(frame)`, `setInOutPoints({inPoint, outPoint})`,
`clearInOutPoints()`, `selectItems(ids)`.

### Timeline mutations (require a loaded project)

- Tracks: `addTrack({kind, name})`, `removeTrack(id)`
- Items: `addItem(agentItem)`, `updateItem(id, partial)`,
  `moveItem(id, {from, trackId})`, `removeItem(id)`,
  `setTransform(id, transform)`
- Effects: `addEffect(itemId, gpuEffect)`, `removeEffect(itemId, effectId)`
- Transitions: `addTransition({leftClipId, rightClipId, durationInFrames, presetId})`,
  `removeTransition(id)`
- Markers: `addMarker({frame, label?, color?})`

All mutations throw with a clear message if no project is loaded.

### Events

`subscribe(callback) → unsubscribe`. Fires on every item / track /
transition change.

## Design notes

- All store accesses are lazy `await import()` — near-zero cost when
  disabled, tree-shakes out if the user never opts in.
- Mutations go through the existing
  `features/timeline/stores/actions/*` modules so undo/redo and
  cross-track bookkeeping stay correct.
- `createProject` / `openProject` wait for `isTimelineLoading` to flip
  false before resolving. Without this, mutations race with the
  editor's async load-on-mount and silently get clobbered.
- DTOs in `types.ts` are a strict subset of the live `TimelineItem`
  shape, matched to `@freecut/sdk`. Snapshots round-trip between the
  SDK/CLI and the live editor without translation.
- Bridging to external agents: the in-page API can be driven via CDP
  (Playwright, `chrome-remote-interface`), a Chrome extension, or an
  MCP server that proxies calls over a tab connection — see
  `packages/mcp/`.

## Known limits

- Keyframes, masks, compositions, keyframed properties are not yet in
  the agent DTO surface. They exist on the live stores; add DTOs +
  methods as specific agent workflows need them.
- `exportSnapshot` returns the on-disk snapshot, so very recent
  in-memory edits may lag until the project saves. Call it after a
  mutation burst has settled if exact fidelity matters.
