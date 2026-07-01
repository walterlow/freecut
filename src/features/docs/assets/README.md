# Docs screenshots

Screenshots for the in-app User Guide (`/docs`) live here and are imported directly
by the page modules in `../pages/*.ts`. This keeps images versioned with the docs and
lets Vite hash + optimize them at build time.

## Add a screenshot

1. Capture a PNG of the relevant editor screen. Recommended: a 16:10-ish crop at
   ~1600px wide, taken in the default dark theme so it matches the docs surface.
2. Save it here with a slug-matched, kebab-case name, e.g. `source-monitor-mark-in-out.png`.
3. Import it in the page module and add a `figure` block:

```ts
import sourceMonitor from '../assets/source-monitor-mark-in-out.png'

// ...inside a section:
{
  kind: 'figure',
  figure: {
    src: sourceMonitor,
    alt: 'The source monitor with an in and out point marked on the range strip.',
    caption: 'Mark In (I) and Mark Out (O) define the range before an insert or overwrite edit.',
  },
}
```

`alt` is required (accessibility). `caption` is optional and renders under the image.

## Guidelines

- **One idea per image.** Crop to the panel being described, not the whole app.
- **Redact nothing sensitive.** Use a throwaway project and sample media.
- **Keep files lean.** Prefer PNG under ~300 KB; compress before committing.
- **Name by topic, not by page number**, so images survive doc reordering.

## Capturing

Screenshots must be taken from a running editor (`npm run dev`) with a granted
workspace and a small demo project loaded — the workspace picker requires a real
folder-permission grant, so this step is done by a human, not automated tooling.
