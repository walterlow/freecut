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

## Agent lifecycle API

The lifecycle interface works on an empty workspace and lets an agent build a
project without first opening the editor. Build the harness, then create and
inspect a project:

```bash
npm run build
npm run headless:agent -- capabilities --workspace "<ws>" --json
npm run headless:agent -- project create --workspace "<ws>" --id demo --name "Demo" --json
npm run headless:agent -- project list --workspace "<ws>" --json
npm run headless:agent -- project get --workspace "<ws>" --id demo --json
```

Mutations return an exact-byte `sha256:...` revision. Supply it on save,
update, persisted edit, and persisted media probe; `--force` is an explicit
overwrite decision.

```bash
npm run headless:agent -- project update --workspace "<ws>" --id demo \
  --name "New name" --expected-revision "sha256:..." --json
npm run headless:agent -- project edit --workspace "<ws>" --id demo \
  --ops edits.json --persist --expected-revision "sha256:..." --json
npm run headless:agent -- media import --workspace "<ws>" --file ./clip.mp4 \
  --id clip_1 --project demo --json
```

Lifecycle edit operations require a unique `callerId`. A later operation can
refer to an ID created earlier, for example
`{"$ref":"clip#/detail/created/0/id"}` in an ID-valued field. Imports are
CLI-only: HTTP accepts neither server-local paths nor media uploads.

The service publishes the same contract under `/v1`: project create/list/get/
save/update/edit; media list/get/probe; capabilities; and strict render.
`POST /v1/projects` and persisted edits require `Idempotency-Key`. The service
takes an exclusive `.freecut-headless/writer.lock`; do not use the interactive
editor on the same workspace during lifecycle mutations. It remains
unauthenticated and loopback-only by default.

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

# Machine-readable output (also supported by edit.mjs)
npm run headless -- --workspace "<ws>" --list --json
```

### Options

| Flag                    | Default                        | Notes                                                                                          |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--workspace <dir>`     | (required)                     | The FreeCut workspace folder (picked in the app).                                              |
| `--project <id\|file>`  | (required)                     | Project id under the workspace, or a path to a `project.json`.                                 |
| `--out <path>`          | `headless/output/<name>.<ext>` | Output file.                                                                                   |
| `--codec <c>`           | `h264`                         | `h264 \| h265 \| vp9 \| vp8 \| av1`. Falls back automatically if unsupported.                  |
| `--container <c>`       | derived                        | `mp4 \| webm \| mov \| mkv` (or `mp3 \| wav \| m4a` with `--audio-only`).                      |
| `--resolution <WxH>`    | project metadata               | e.g. `1920x1080`.                                                                              |
| `--fps <n>`             | project metadata               |                                                                                                |
| `--quality <q>`         | `high`                         | `low \| medium \| high \| ultra` (controls bitrate).                                           |
| `--in <sec>`            | 0                              | Render range start (seconds).                                                                  |
| `--out-sec <sec>`       | end                            | Render range end (seconds).                                                                    |
| `--duration <sec>`      | —                              | Render this many seconds from `--in`.                                                          |
| `--audio-only`          | off                            | Render audio only.                                                                             |
| `--allow-missing-media` | off                            | Permissive human workflow: render gaps for missing sources and emit a `MISSING_MEDIA` warning. |
| `--build`               | off                            | Build `dist/` first if the harness isn't built.                                                |
| `--head`                | off                            | Run a visible browser for debugging.                                                           |
| `--harness-url <url>`   | —                              | Dev mode: drive a running `npm run dev` server instead of `dist/`.                             |

## Notes & limitations

All CLIs support `--help`, reject unknown flags, and accept `--json` for a
single machine-readable result without progress output.

- **Media must be mirrored to the workspace folder on disk.** The CLI reads
  `media/<id>/<file>`. Missing referenced media fails before browser rendering
  by default. Open the project in FreeCut once so it is mirrored, or use
  `--allow-missing-media` explicitly when blank/silent gaps are acceptable.
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

| op                                                | fields                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `addText`                                         | `text`, `from`, `durationInFrames`, `trackId?`, `color?`, `fontSize?`, `fontWeight?`, `textAlign?`, `verticalAlign?`                      |
| `addItem`                                         | `item` (a full `TimelineItem`)                                                                                                            |
| `updateItem`                                      | `id`, `updates` (partial `TimelineItem`)                                                                                                  |
| `moveItem`                                        | `id`, `from`, `trackId?`                                                                                                                  |
| `removeItems`                                     | `ids` (array)                                                                                                                             |
| `split`                                           | `id`, `frame`                                                                                                                             |
| `trimStart` / `trimEnd`                           | `id`, `amount`                                                                                                                            |
| `addTransition`                                   | `leftClipId`, `rightClipId`, `type?`, `durationInFrames?`                                                                                 |
| `addClip`                                         | `mediaId`, `from`, `trackId?`, `durationInFrames?` (video adds a linked audio companion; source range computed from the media's metadata) |
| `addTrack`                                        | `kind?` (`video`\|`audio`), `order?`                                                                                                      |
| `updateTrack`                                     | `id`, `updates` (`name`, `order`, `locked`, `syncLock`, `visible`, `muted`, `solo`, `volume`, `audioEq`, etc.)                            |
| `removeTrack`                                     | `id`                                                                                                                                      |
| `addKeyframe`                                     | `itemId`, `property`, `frame`, `value`, `easing?`                                                                                         |
| `removeKeyframes`                                 | `itemId`, `property`                                                                                                                      |
| `addEffect`                                       | `itemId`, `gpuEffectType` + `params?` (or a full `effect` object)                                                                         |
| `removeEffect`                                    | `itemId`, `effectId`                                                                                                                      |
| `setTransform`                                    | `id`, `transform` (e.g. `{ "x": 0, "y": 150, "opacity": 0.5, "rotation": 0 }`)                                                            |
| `addMarker` / `updateMarker` / `removeMarker`     | marker frame/id and updates                                                                                                               |
| `setInPoint` / `setOutPoint` / `clearInOutPoints` | timeline range                                                                                                                            |
| `setMasterAudio`                                  | `masterBusDb?`, `busAudioEq?`                                                                                                             |
| `setProjectSettings`                              | `name?`, `description?`, `duration?`, `width?`, `height?`, `fps?`, `backgroundColor?`                                                     |

Operations are validated before Chrome starts. Item and track references must
exist and be compatible. `removeItems` rejects the entire operation if any
requested id is missing, so it never reports success for a partial request.

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
curl localhost:8787/capabilities
curl localhost:8787/projects
curl -X POST localhost:8787/render -H 'content-type: application/json' \
  -d '{"project":"<id>","codec":"vp9","duration":5}' -o out.webm
curl -X POST localhost:8787/edit -H 'content-type: application/json' \
  -d '{"project":"<id>","ops":[{"op":"addText","text":"Hi","from":0}]}'
```

| Route                                  | Body                                                                                                               | Returns                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `GET /health`                          | —                                                                                                                  | `{ ok, apiVersion, gpu: { available, vendor, architecture }, software, harnessUrl }` |
| `GET /capabilities`                    | —                                                                                                                  | API version, operations, options, and JSON Schemas.                                  |
| `GET /projects`                        | —                                                                                                                  | `[{ id, projectId, name, updatedAt }]`; `id` is the actionable directory key.        |
| `POST /render`                         | `{ project\|projectObject, codec?, container?, resolution?, fps?, quality?, in?, outSec?, duration?, audioOnly? }` | the rendered file (attachment)                                                       |
| `POST /edit`                           | `{ project\|projectObject, ops, ... }`                                                                             | `{ ok, project, applied, results }`                                                  |
| `GET /v1/projects/:projectId/snapshot` | —                                                                                                                  | `{ revision, project, media, missingMediaIds }`                                      |
| `POST /v1/projects/:projectId/edit`    | `{ ops, persist?, expectedRevision?, force? }`                                                                     | validated lifecycle edit; persisted edits return the saved project revision          |
| `GET /v1/events?projectId=:projectId`  | —                                                                                                                  | SSE `project.changed` events                                                         |

`project` is a workspace project id; `projectObject` is an inline Project JSON.
Media is resolved from the service's workspace by id.

### Render success contract

Render requests are strict by default. This includes the HTTP service, batch
files, and `--json` automation. Missing referenced media returns a stable
`MISSING_MEDIA` error (HTTP 422) and no artifact. Only the CLI's explicit
`--allow-missing-media` mode permits an incomplete artifact.

Every successful render summary contains `effectiveSettings` (mode, codec,
audio codec, container, resolution, FPS, and quality) and structured
`warnings`. Output extension, attachment filename, and HTTP `Content-Type` are
selected from the effective browser result after codec adaptation, not from
the requested container. CLI `--json` includes this summary. HTTP file
responses expose the same warning array as JSON in `X-Freecut-Warnings`.

Stable warning codes are:

| Code                         | Meaning                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `CODEC_FALLBACK`             | The requested video codec was unavailable; `effectiveSettings` identifies the codec/container used. |
| `MISSING_MEDIA`              | Permissive CLI mode rendered one or more missing sources as gaps.                                   |
| `UNSUPPORTED_AUDIO`          | A source audio codec cannot be decoded headlessly and may be silent.                                |
| `WEBGPU_TRANSITION_FALLBACK` | Transitions used the Canvas2D path because WebGPU was unavailable.                                  |

`ok: true` means bytes were produced after strict preconditions passed. It does
not mean there were no non-fatal degradations; callers must inspect `warnings`.

The service serializes browser work and bounds both execution time and backlog.
Defaults are a 30-minute whole-render deadline, a 2-minute whole-edit deadline,
eight waiting operations, and a 30-second graceful shutdown drain. Configure
them with `--render-timeout-ms`, `--edit-timeout-ms`, `--max-queue-depth`, and
`--shutdown-timeout-ms`. A full queue returns HTTP 429. A timed-out operation
returns HTTP 504 and the disposable browser page is recreated before the next
queued operation starts.

The HTTP API version is `1`. HTTP bodies use canonical camelCase fields
`inSec`, `outSec`, and `audioOnly`; CLI aliases are normalized before
validation. Bodies are strict, edit operation arrays must be nonempty, numeric
values must be finite and bounded, and exactly one of `project` or
`projectObject` is required.

Validation failures return HTTP 400 in a stable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "fields": [{ "path": "ops", "message": "Invalid input", "code": "too_small" }],
    "apiVersion": 1
  }
}
```

Unexpected failures use the same envelope with HTTP 500 and
`code: "INTERNAL_ERROR"`. Breaking contract changes require an API version
bump. New edit operations must update the schema, capabilities, docs, and tests.

The native service binds to `127.0.0.1` by default because it has no
authentication. Use `--host <address>` (or `FREECUT_HOST`) only when an explicit
network bind is required; the command-line option takes precedence over the
environment variable.

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
  -v /path/to/FreeCutProjects:/workspace freecut-headless

# Confirm it's using the real GPU (not software):
curl localhost:8787/health
#  good:  {"ok":true,"gpu":{"available":true,"vendor":"nvidia",...},"software":false}
#  bad:   {... "vendor":"mesa","architecture":"llvmpipe", "software":true}
#         GPU-effect renders are rejected with HARDWARE_GPU_REQUIRED.
curl -X POST localhost:8787/render -H 'content-type: application/json' \
  -d '{"project":"<id>","duration":5}' -o out.mp4
```

The image explicitly sets `FREECUT_HOST=0.0.0.0` so Docker's published port is
reachable from the host. The API has no authentication or TLS and can read
workspace media and edit/render projects. Restrict port 8787 with the host
firewall or publish it only on loopback (`-p 127.0.0.1:8787:8787`). If remote
access is required, place the service behind an authenticated TLS reverse proxy.

Without `--gpus all` (or on Windows), the container falls back to software
WebGPU: cuts/text/transitions and audio still render, but GPU-effect projects
are rejected with `HARDWARE_GPU_REQUIRED` before rendering.

### What's verified

In-container against a real workspace:

- Builds and serves; renders **video, text, and transitions**.
- **Audio works, including AAC** — the `@mediabunny/aac-encoder` WASM polyfill is
  registered automatically when there's no native AAC encoder (Linux Chrome); Opus
  (webm) and MP3 also work.
- **GPU effects** need a real GPU. Software WebGPU (lavapipe and SwiftShader)
  can return blank frames without failing, so the service rejects those jobs.

### Why Windows Docker can't use the GPU

Docker Desktop on Windows runs containers in a WSL2 VM that exposes CUDA/NVENC and
`/dev/dxg` but **no Vulkan ICD** (`vulkaninfo` finds no driver in-container), and
WebGPU needs Vulkan. So GPU effects in Docker require a **native Linux GPU host**;
on Windows/macOS, render natively instead.

## Dev/regression scripts

The portable quality gate is layered so a production build is reused:

| Command                          | Coverage                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run headless:test`          | Builds once, then runs every portable layer.                                                                                      |
| `npm run headless:test:node`     | Fast schemas, CLI, workspace, HTTP security, render outcomes, binding, and queue recovery.                                        |
| `npm run headless:test:chrome`   | Built-harness render/edit regression plus success, persisted state, and meaningful failure coverage for every edit discriminator. |
| `npm run headless:test:media`    | Generates a PCM tone in the OS temp directory, range-serves it, renders WAV, and asserts non-silent audio bytes.                  |
| `npm run headless:test:portable` | Reuses an existing `dist/`; this is what CI and `npm run verify` call after their build.                                          |

The schema/test parity assertion in `edit-operations.mjs` fails when a new
public edit operation has no Chrome contract case. All portable artifacts use
OS temporary directories and are deleted after the test. No binary media
fixture or optional host codec is required.

Real-GPU effects are deliberately outside the portable PR gate. Before a GPU
release or deployment, run `npm run headless:gpu:probe` on the target machine,
confirm a non-software adapter, then render the affected project/effects with
`npm run headless` or the service. A passing portable suite does not claim GPU
shader or pixel-level coverage.

Legacy/manual helpers remain available:

- `node headless/smoke.mjs` — zero-media text render against a running dev server.
- `node headless/media-smoke.mjs` — MP4 video/audio smoke against a running dev server and local `headless/assets/testclip.mp4`.
