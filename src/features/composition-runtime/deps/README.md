# Composition Runtime Adapters

`deps/*` files are the integration boundary for `composition-runtime`.

- Runtime components/hooks/utils should import cross-feature dependencies only from `deps/*`.
- `deps/*` modules may import from other feature modules and re-export those APIs.
- This keeps runtime internals decoupled from direct cross-feature paths.
