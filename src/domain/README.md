# domain

Framework-agnostic business logic.

This layer should contain pure logic, models, and calculations that are
independent of React, routes, and browser infrastructure.

## Current Modules

- `animation/easing.ts`: easing math primitives.
- `timeline/defaults.ts`: timeline defaults and constants.
- `timeline/transitions/*`: transition planning/registry/engine modules.
- `projects/migrations/*`: project migration and normalization modules.
