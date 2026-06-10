# Composition Runtime Adapters

`deps/*` files are the integration boundary for `composition-runtime`.

- Runtime components/hooks/utils should import cross-feature dependencies only from `deps/*`.
- `deps/*` modules may import from other feature modules and re-export those APIs.
- This keeps runtime internals decoupled from direct cross-feature paths.

Prefer narrow adapters such as `media-library-store.ts` when a utility only
needs one feature surface. Use `stores.ts` for runtime components that need a
mixed set of store hooks.
