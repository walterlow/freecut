# Core-First Architecture

FreeCut should move toward a shared core that owns the project model,
validation, workspace inspection, render planning, and automation-friendly
rules. The browser editor should be the human interface over that core, not the
only place where project truth can be understood.

The SDK should not become the core itself. It should remain the ergonomic public
authoring facade that uses the core contracts underneath.

## Current State

- The browser editor owns most runtime behavior, including workspace
  persistence, preview, export, and the interactive editing model.
- `@freecut/sdk` authors `.fcproject` snapshots and validates a deliberate
  subset of the editor project shape.
- `@freecut/cli` supports terminal automation, workspace inspection, and
  browser-backed rendering.
- `@freecut/mcp` bridges AI agents into a live editor tab through the agent API.
- `src/core` already contains some app-agnostic rules such as timeline defaults,
  transition planning, easing, and project migrations.

This works, but it leaves important automation behavior split across the editor,
SDK, CLI, and MCP bridge. Range math, media readiness, validation, and workspace
inspection should converge on shared implementation instead of drifting by
adapter.

## Target Architecture

The long-term direction is a reusable core boundary, likely published as
`@freecut/core` once the package API is stable.

`@freecut/core` should own canonical domain behavior:

- project types, migrations, normalization, validation, and linting
- timeline math, frame/range conversion, IO markers, and render range planning
- workspace project inspection over plain files
- media dependency analysis for whole projects and render ranges
- pure serialization and snapshot compatibility helpers

`@freecut/sdk` should provide a fluent authoring API over core:

- builder ergonomics for humans, scripts, and agents
- deterministic id helpers and convenience methods
- validation and serialization delegated to core-owned contracts

`@freecut/cli` should be terminal automation over core plus render adapters:

- list and inspect projects from a workspace folder
- check media readiness before rendering
- build render plans from the same rules the editor uses
- keep browser-backed rendering as the first render adapter

`@freecut/mcp` should remain a live editor control adapter:

- expose interactive editor state and commands to agents
- forward live editing operations through the browser tab
- use shared contracts where tool inputs overlap with SDK/CLI behavior

The FreeCut editor should remain the full human UI:

- project management, workspace permission UX, preview, export UI, and editing
  interactions
- browser runtime adapters for File System Access, OPFS, WebGPU, WebCodecs, and
  DOM media primitives
- calls into core for shared project rules instead of reimplementing them inside
  feature UI or agent surfaces

## Migration Plan

1. Document and consolidate duplicated CLI workspace/render helpers.
   - Keep behavior unchanged.
   - Reduce duplicate project selection, range resolution, and media readiness
     code inside CLI commands.

2. Extract canonical project, range, and media logic into the core boundary.
   - Start with pure functions that do not depend on React, browser APIs,
     FileSystemHandle, DOM media elements, or Node-only process state.
   - Cover project validation, render range resolution, and media dependency
     discovery with focused unit tests.

3. Move SDK validation and types toward core-owned contracts.
   - Keep the existing SDK builder API stable where possible.
   - Delegate snapshot parsing, serialization, validation, and linting to the
     shared core implementation.

4. Make CLI workspace commands depend on core.
   - `workspace projects`, `workspace inspect`, `workspace media`, and
     `render --workspace --check` should use the same project and media planning
     logic.
   - Workspace inspection should work from disk without relying on browser File
     System Access permission state.

5. Make editor and agent APIs call core for shared planning and validation.
   - Editor feature code should keep browser-specific adapters local.
   - Agent and render APIs should use core rules for range planning, snapshot
     validation, and deterministic missing-media reports.

## Non-Goals

- Do not build a Node-native renderer in this phase.
- Do not rewrite the editor around a new state model.
- Do not remove browser-backed export or the existing WebCodecs/WebGPU render
  path.
- Do not make the SDK the canonical owner of project truth.

## Acceptance Criteria

- SDK, CLI, MCP, and editor paths use the same validation, range, and media
  planning logic where their behavior overlaps.
- Workspace project listing, inspection, media checks, and render checks work
  from disk without depending on browser workspace permission state.
- Browser rendering remains available through the existing export path.
- Automation paths can inspect a project before rendering and report missing
  media deterministically.
- The core boundary stays portable: no React, route, DOM, FileSystemHandle, or
  browser storage dependencies leak into shared domain modules.
