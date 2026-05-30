# FreeCut Headless

Render **and edit** FreeCut projects from the command line — no editor UI — by
driving the **real** engine and timeline action modules inside headless Chrome
via Playwright.

Because the engine depends on browser APIs (WebCodecs, WebGPU, OffscreenCanvas,
OfflineAudioContext), a Node port would be a fragile rewrite. Instead, a tiny
Node driver launches headless Chrome, loads a UI-less harness page (`window.freecut`)
that reuses the exact export pipeline and Zustand timeline stores, and captures
the output. Fidelity matches the in-app export — including hardware GPU effects,
transitions, audio, and (for edits) transition repair + linked-clip cascades.

Two CLIs:
- **`render.mjs`** (`npm run headless`) — render a project (or a slice) to video/audio.
- **`edit.mjs`** — apply structural edits (add/split/trim/move/delete/transition) and write the project back.

## How it works

```
Node CLI (render.mjs)
  ├─ reads the workspace folder on disk (project.json + media/<id>/)
  ├─ serves the built harness (dist/) + media on one COEP-isolated origin,
  │    with HTTP Range (server.mjs)   [default — no dev server needed]
  └─ launches headless Chrome (Playwright, channel: chrome)
         └─ loads headless.html → src/headless/main.ts (window.freecut)
                ├─ migrateProject + convertTimelineToComposition
                ├─ registers media URLs (range-streamed via mediabunny UrlSource)
                └─ renderComposition → Blob → download → saved by the driver
```

The browser harness lives in `src/headless/` (TypeScript, built by Vite). The
Node driver lives here in `headless/*.mjs` (plain ESM, run directly).

Media is **range-streamed**, not downloaded: the harness registers each media
file's HTTP URL (no Blob), so mediabunny reads only the byte ranges it needs.
A 5-second slice of a 3 GB source renders without loading the whole file.

## Prerequisites

- Google Chrome installed (the driver uses `channel: 'chrome'`).
- `playwright` (already a devDependency).
- A built harness (`dist/`). Build it once:

  ```bash
  npm run build      # produces dist/headless.html (re-run after harness changes)
  ```

  The CLI serves `dist/` itself — **no dev server required**. (Or pass `--build`
  to have the CLI build automatically when `dist/` is missing.)

## Usage

```bash
# List projects in a workspace folder
npm run headless -- --workspace "C:\path\to\workspace" --list

# Render a project to MP4 (H.264 + AAC), using the project's resolution/fps
npm run headless -- --workspace "C:\path\to\workspace" --project <projectId> \
  --out ./my-render.mp4

# Render only a slice (great for very long projects)
npm run headless -- --workspace "<ws>" --project <id> --in 10 --duration 5

# Override codec / container / resolution / fps
npm run headless -- --workspace "<ws>" --project <id> \
  --codec vp9 --container webm --resolution 1920x1080 --fps 30 --quality ultra

# Audio only
npm run headless -- --workspace "<ws>" --project <id> --audio-only --container mp3
```

### Options

| Flag | Default | Notes |
|------|---------|-------|
| `--workspace <dir>` | (required) | The FreeCut workspace folder (picked in the app). |
| `--project <id\|file>` | (required) | Project id under the workspace, or a path to a `project.json`. |
| `--out <path>` | `headless/output/<name>.<ext>` | Output file. |
| `--codec <c>` | `h264` | `h264 \| h265 \| vp9 \| vp8 \| av1`. Falls back automatically if unsupported. |
| `--container <c>` | derived | `mp4 \| webm \| mov \| mkv` (or `mp3 \| wav \| m4a` with `--audio-only`). |
| `--resolution <WxH>` | project metadata | e.g. `1920x1080`. |
| `--fps <n>` | project metadata | |
| `--quality <q>` | `high` | `low \| medium \| high \| ultra` (controls bitrate). |
| `--in <sec>` | 0 | Render range start (seconds). |
| `--out-sec <sec>` | end | Render range end (seconds). |
| `--duration <sec>` | — | Render this many seconds from `--in`. |
| `--audio-only` | off | Render audio only. |
| `--build` | off | Build `dist/` first if the harness isn't built. |
| `--head` | off | Run a visible browser for debugging. |
| `--harness-url <url>` | — | Dev mode: drive a running `npm run dev` server instead of `dist/`. |

## Notes & limitations

- **Media must be mirrored to the workspace folder on disk.** The CLI reads
  `media/<id>/<file>`. If a media source is missing (imported but never read in
  the app), open the project in FreeCut once so it's mirrored, then re-run.
- **Codec support is verified at render time** and falls back the same way the
  app does (e.g. H.264 → VP9 if unavailable). Headless Chrome here supports
  H.264/HEVC/VP9/AV1 video and AAC/Opus audio with hardware WebGPU.
- **Audio codecs:** AAC/MP3/Opus/Vorbis/FLAC/PCM decode natively; **AC-3/E-AC-3
  (Dolby Digital / DD+) decode via `@mediabunny/ac3`** — the CLI passes each
  media's `metadata.json` to the harness, which seeds the media-library store so
  the codec is recognized and the AC-3 decoder is registered. Truly exotic
  codecs (e.g. DTS) still can't be decoded headlessly; the CLI warns and that
  audio is silent (video unaffected). Supporting those would need a Node-side
  pre-decode (ffmpeg / `@mediabunny/server`) — not wired up since it needs a
  heavy native dependency and is rarely needed.
- A harmless `Video load error` may log — that's the optional DOM `<video>`
  fallback; decode goes through mediabunny/WebCodecs and is unaffected.

## Editing (edit.mjs)

Applies a list of edit ops by driving the **real** timeline action modules
(`hydrateTimelineStoresFromProject` → actions → `buildTimelineFromStores`), so
transition repair, track ordering, split-id rebinding, and linked video/audio
cascades all behave exactly like the editor.

```bash
# Dry run (apply ops, print result, write nothing)
node headless/edit.mjs --workspace "<ws>" --project <id> --ops edits.json

# Write the edited project to a new file
node headless/edit.mjs --workspace "<ws>" --project <id> --ops edits.json --out ./edited.json

# Overwrite the source project.json (destructive — explicit opt-in)
node headless/edit.mjs --workspace "<ws>" --project <id> --ops edits.json --in-place
```

Safe by default: with neither `--out` nor `--in-place` it's a dry run.

`edits.json` is an array of ops (each `{ "op": "<name>", ... }`):

| op | fields |
|----|--------|
| `addText` | `text`, `from`, `durationInFrames`, `trackId?`, `color?`, `fontSize?`, `fontWeight?`, `textAlign?`, `verticalAlign?` |
| `addItem` | `item` (a full `TimelineItem`) |
| `updateItem` | `id`, `updates` (partial `TimelineItem`) |
| `moveItem` | `id`, `from`, `trackId?` |
| `removeItems` | `ids` (array) |
| `split` | `id`, `frame` |
| `trimStart` / `trimEnd` | `id`, `amount` |
| `addTransition` | `leftClipId`, `rightClipId`, `type?`, `durationInFrames?` |
| `addClip` | `mediaId`, `from`, `trackId?`, `durationInFrames?` (video adds a linked audio companion; source range computed from the media's metadata) |
| `addTrack` | `kind?` (`video`\|`audio`), `order?` |
| `addKeyframe` | `itemId`, `property`, `frame`, `value`, `easing?` |
| `removeKeyframes` | `itemId`, `property` |
| `addEffect` | `itemId`, `gpuEffectType` + `params?` (or a full `effect` object) |
| `removeEffect` | `itemId`, `effectId` |
| `setTransform` | `id`, `transform` (e.g. `{ "x": 0, "y": 150, "opacity": 0.5, "rotation": 0 }`) |

`addClip` reads the media's `metadata.json` (passed automatically by the CLI),
so its source range, fps, and audio companion match an in-app import.

```json
[
  { "op": "updateItem", "id": "text-1", "updates": { "text": "New caption", "color": "#ff3366" } },
  { "op": "split", "id": "vid-1", "frame": 45 },
  { "op": "addText", "text": "Outro", "from": 120, "durationInFrames": 60, "color": "#ffffff" }
]
```

## Render service (serve.mjs)

For automation / many renders, run a long-lived service that keeps one warm
Chrome + harness over a workspace, avoiding the per-call cold start. Requests
are serialized (one page op at a time).

```bash
npm run headless:serve -- --workspace "<ws>" --port 8787   # add --build on first run

# then:
curl localhost:8787/health
curl localhost:8787/projects
curl -X POST localhost:8787/render -H 'content-type: application/json' \
  -d '{"project":"<id>","codec":"vp9","duration":5}' -o out.webm
curl -X POST localhost:8787/edit -H 'content-type: application/json' \
  -d '{"project":"<id>","ops":[{"op":"addText","text":"Hi","from":0}]}'
```

| Route | Body | Returns |
|-------|------|---------|
| `GET /health` | — | `{ ok, gpu: { available, vendor, architecture }, software, harnessUrl }` |
| `GET /projects` | — | `[{ id, name, updatedAt }]` |
| `POST /render` | `{ project\|projectObject, codec?, container?, resolution?, fps?, quality?, in?, outSec?, duration?, audioOnly? }` | the rendered file (attachment) |
| `POST /edit` | `{ project\|projectObject, ops, ... }` | `{ ok, project, applied, results }` |

`project` is a workspace project id; `projectObject` is an inline Project JSON.
Media is resolved from the service's workspace by id.

## Docker (Linux GPU server deployment)

**Docker here is for deploying the render service on a Linux host with an NVIDIA
GPU** — not for desktop use. On Windows/macOS, **render natively**
(`npm run headless:serve`); Docker Desktop on Windows runs containers in a WSL2
VM that exposes CUDA/NVENC but **no Vulkan**, so WebGPU there is software-only
and GPU effects can't run. Use the container on a real Linux GPU box (or render
natively).

```bash
# Build (context = repo root)
docker build -f headless/Dockerfile -t freecut-headless .

# Run on a Linux host WITH a GPU (NVIDIA Container Toolkit installed):
docker run --rm -p 8787:8787 --gpus all -e NVIDIA_DRIVER_CAPABILITIES=all \
  -v /path/to/FreeCutProjects:/workspace:ro freecut-headless

# Confirm it's using the real GPU (not software):
curl localhost:8787/health
#  good:  {"ok":true,"gpu":{"available":true,"vendor":"nvidia",...},"software":false}
#  bad:   {... "vendor":"mesa","architecture":"llvmpipe", "software":true}  -> effects will fail
curl -X POST localhost:8787/render -H 'content-type: application/json' \
  -d '{"project":"<id>","duration":5}' -o out.mp4
```

Without `--gpus all` (or on Windows), the container falls back to software
WebGPU: cuts/text/transitions and audio still render, but GPU effects fail with
a clear error and the service logs a warning at startup.

### What's verified

In-container against a real workspace:

- Builds and serves; renders **video, text, and transitions**.
- **Audio works, including AAC** — the `@mediabunny/aac-encoder` WASM polyfill is
  registered automatically when there's no native AAC encoder (Linux Chrome); Opus
  (webm) and MP3 also work.
- **GPU effects** need a real GPU. Software WebGPU (lavapipe and SwiftShader) hits a
  Dawn device-loss on the effects pipeline, surfaced as a clear render error.

### Why Windows Docker can't use the GPU

Docker Desktop on Windows runs containers in a WSL2 VM that exposes CUDA/NVENC and
`/dev/dxg` but **no Vulkan ICD** (`vulkaninfo` finds no driver in-container), and
WebGPU needs Vulkan. So GPU effects in Docker require a **native Linux GPU host**;
on Windows/macOS, render natively instead.

## Dev/regression scripts

- `node headless/probe.mjs` — report WebGPU + WebCodecs support in headless Chrome.
- `node headless/smoke.mjs` — render a zero-media text title to WebM.
- `node headless/media-smoke.mjs` — render a generated test clip (video+audio) to MP4.
