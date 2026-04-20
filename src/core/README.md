# core

Application-agnostic rules, calculations, and schema transforms.

This layer is where timeline math, transition planning, easing, and project
migration logic live. It should avoid React, routes, and browser or storage
adapters. Depending on low-level shared primitives is fine when the logic stays
portable and testable.

## Current Modules

- `animation/easing.ts`: easing math primitives.
- `timeline/defaults.ts`: portable timeline defaults.
- `timeline/transitions/*`: transition planning, registry, and renderer logic.
- `projects/migrations/*`: schema migrations and normalization modules.
