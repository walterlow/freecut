# @freecut/cli

Command-line interface for authoring FreeCut projects. Wraps
[`@freecut/sdk`](../sdk) so you can build `.fcproject` snapshots from the
shell, Makefiles, CI, or agent tool calls.

Every command accepts `--json` for machine-readable output. Commands
that create something emit the new id on stdout so you can chain calls.

## Install

```bash
npm i -g @freecut/cli      # future — ships `freecut`
node packages/cli/bin/freecut.mjs --help   # from this repo today
```

## Agent-style flow

```bash
F=./demo.fcproject

freecut doctor --json
freecut new "$F" --name demo --fps 30 --width 1920 --height 1080

TRACK=$(freecut track add "$F" --kind video --name V1 --json | jq -r .trackId)

freecut media add "$F" \
  --id media-intro \
  --file-name intro.mp4 \
  --duration 10 --width 1920 --height 1080 --fps 30 \
  --codec avc1 --bitrate 8000000

CLIP_A=$(freecut clip add "$F" \
  --type video --track "$TRACK" \
  --from 0 --duration 3 \
  --media-id media-intro --src intro.mp4 --json | jq -r .itemId)

CLIP_B=$(freecut clip add "$F" \
  --type video --track "$TRACK" \
  --from 3 --duration 3 \
  --media-id media-intro --src intro.mp4 --json | jq -r .itemId)

freecut transition add "$F" --left "$CLIP_A" --right "$CLIP_B" \
  --duration 0.5 --preset fade

freecut effect add "$F" --item "$CLIP_A" \
  --gpu-type gaussian-blur --params '{"radius":10}'

freecut inspect "$F"
freecut lint "$F" --json

# Browser-backed render. Requires Chrome/Edge with remote debugging and
# a FreeCut tab with the agent API enabled.
freecut render "$F" --output demo.mp4 --format mp4 --quality high
freecut render --project ABC --start 0 --duration 5 --output ABC-first-5s.mp4
```

## Commands

| Command | Purpose |
| --- | --- |
| `doctor [file]` | Check the local CLI/SDK environment and optionally validate a project |
| `new <file>` | Create a new `.fcproject` with project settings |
| `inspect <file>` | Human- or `--json`-readable summary |
| `lint <file>` | Validate snapshot structure and timeline references |
| `render <file>` | Load a snapshot into a running FreeCut tab and render via the browser export engine |
| `render --project <name>` | Open an existing workspace project by id/name and render it |
| `track add <file>` | Add a video or audio track |
| `clip add <file> --type ...` | Add video / audio / image / text / shape / adjustment |
| `media add <file>` | Register a media reference (editor resolves on import) |
| `effect add <file>` | Attach a GPU effect to an existing clip |
| `transition add <file>` | Add a cross-clip transition |
| `marker add <file>` | Place a project marker |

## Design notes

- Snapshots are written atomically (`<file>.tmp` + rename) — crash-safe.
- Frame math is in source time (seconds) at the CLI surface; the SDK
  converts to the project's fps internally.
- The CLI does not embed media. It writes a `ProjectSnapshot` JSON that
  the FreeCut editor opens via its existing JSON import service; media is
  resolved on the target workspace by id, content hash, or filename.
- `render` is browser-backed in this first version. Start Chrome with
  `--remote-debugging-port=9222`, open FreeCut, grant the workspace, and
  enable `?agent=1` in production. The command renders with the same
  WebCodecs/WebGPU path as the app and returns encoded chunks to the CLI.
- `render` range flags are `--start`, `--end`, `--duration` in seconds, or
  `--in-frame` / `--out-frame` in project frames. Ranges override timeline
  IO markers for that render only.
