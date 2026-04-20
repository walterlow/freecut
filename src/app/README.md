# app

Application shell and composition root.

Put router setup, global providers, startup wiring, and app-level editor shell
configuration here.

Current modules:

- `editor-layout.ts`: editor density presets and shell layout helpers.
- `state/*`: app-level workflow stores that span multiple editor-facing features
  without belonging to generic shared state.
