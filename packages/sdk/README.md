# @freecut/sdk

Programmatic authoring of FreeCut projects. Build `.fcproject` snapshots
in Node, Bun, browsers, or agent sandboxes — the FreeCut editor opens
the output via its existing JSON import service.

Zero runtime dependencies.

## Quick start

```ts
import { createProject, serialize, deterministicIds } from '@freecut/sdk';
import { writeFileSync } from 'node:fs';

const p = createProject({
  name: 'agent-edit',
  fps: 30,
  width: 1920,
  height: 1080,
  ids: deterministicIds(), // reproducible ids for replays
});

p.addMediaReference({
  id: 'clip-a',
  fileName: 'intro.mp4',
  fileSize: 0,
  mimeType: 'video/mp4',
  duration: 5,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'avc1',
  bitrate: 8_000_000,
});

const video = p.addTrack({ kind: 'video', name: 'V1' });

const clip = p.addVideoClip({
  trackId: video.id,
  from: 0,
  durationInFrames: p.secondsToFrames(5),
  mediaId: 'clip-a',
});

p.addTextClip({
  trackId: p.addTrack({ kind: 'video', name: 'Titles' }).id,
  from: p.secondsToFrames(1),
  durationInFrames: p.secondsToFrames(3),
  text: 'Hello, FreeCut',
  fontSize: 120,
  color: '#ffffff',
});

p.applyGpuEffect(clip.id, {
  type: 'gpu-effect',
  gpuEffectType: 'gaussian-blur',
  params: { radius: 6 },
});

p.touch();

writeFileSync('out.fcproject', serialize(p));
```

## API surface

- `createProject(opts)` — builder entry point.
- `builder.addTrack()`, `addVideoClip()`, `addAudioClip()`, `addImageClip()`,
  `addTextClip()`, `addShapeClip()`, `addAdjustmentLayer()`
- `builder.applyGpuEffect()`, `setTransform()`, `split()`, `addTransition()`,
  `addMarker()`
- `builder.setInOutPoints()`, `setRenderRange()`, `clearInOutPoints()` for
  render IO markers
- `builder.secondsToFrames()`, `endOfTrack()`, `touch()`
- `serialize(p)` / `parse(json)` — JSON round-trip
- `validateSnapshot(snapshot)` / `lintSnapshot(snapshot)` — structural checks
  for agent-authored project files
- `deterministicIds()` / `randomIds` — id generation

## Relationship to the editor

The SDK writes the same `ProjectSnapshot` shape the editor produces for
"Export → JSON". Snapshots carry project structure + media *references*
(metadata only). Media files travel separately; the editor resolves them
on import by id, content hash, or filename against the workspace folder.

Types here are a deliberate subset of the full editor types. Anything the
SDK emits is accepted by the editor's zod schema. Fields the SDK doesn't
model (per-band audio EQ, keyframes, sub-compositions, masks) fall
through as plain JSON if hand-authored, but there's no typed builder for
them yet.
