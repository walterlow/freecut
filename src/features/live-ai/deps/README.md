# live-ai/deps

Adapters for cross-feature dependencies (boundary-compliant).

- **editor.ts**: live-ai → editor. Re-exports `useTimelineStore`, `useProjectStore` from editor. Use from live-ai components (e.g. `../deps/editor`) instead of importing from `@/features/editor` directly.
- **editor-public.ts**: Public API for editor → live-ai. Re-exports `LiveAIPopover`, `LiveAIPanelContent`, `useLiveSessionStore`. Editor imports these via `@/features/editor/deps/live-ai`, not from live-ai directly.
