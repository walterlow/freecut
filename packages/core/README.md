# @freecut/core

Shared FreeCut domain planning helpers.

This package is the first reusable core boundary for automation-safe project
logic. It currently owns pure workspace/project inspection, render range
resolution, media usage collection, and workspace render-source planning.

It intentionally avoids React, routes, DOM media elements, FileSystemHandle,
browser storage, WebGPU, and WebCodecs. Browser and Node adapters should call
into this package instead of duplicating project/range/media rules.

## Current surface

- `parseSnapshot(json)`
- `serializeSnapshot(source, opts)`
- `toSnapshot(source, opts)`
- `SnapshotParseError`
- `deterministicIds(seed)`
- `randomIds(kind)`
- `secondsToFrames(seconds, fps)`
- `framesToSeconds(frames, fps)`
- `validateSnapshot(snapshot, opts)`
- `lintSnapshot(snapshot, opts)`
- `buildRange(values)`
- `resolveProjectRenderRange(project, requestedRange, renderWholeProject)`
- `collectProjectMediaUsage(project, range)`
- `listWorkspaceProjects(workspace, opts)`
- `inspectWorkspaceProject(workspace, selector, opts)`
- `inspectWorkspaceMedia(workspace, selector, opts)`
- `loadWorkspaceRenderSource(workspace, selector, renderConfig, deps)`
- `readWorkspaceProject(workspace, selector, opts)`
- `findWorkspaceMediaSource(mediaDir, opts)`
- `mimeTypeFromFileName(file)`

## Source layout

- `index.ts`: public export barrel only.
- `snapshot.ts`: snapshot parse/serialize helpers.
- `validation.ts`: snapshot validation and linting.
- `workspace.ts`: workspace inspection, render range, and media planning.
- `time.ts`: frame/second conversion.
- `ids.ts`: deterministic and random id generation.
