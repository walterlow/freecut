# FreeCut

**[freecut-sandy.vercel.app](https://freecut-sandy.vercel.app/)**

**Edit videos. In your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![FreeCut Timeline Editor](./public/assets/landing/timeline.png)

FreeCut is a browser-based multi-track video editor. No installation, no uploads — everything runs locally in your browser using WebCodecs, OPFS, and the File System Access API.

## Features

### Timeline & Editing

- Multi-track timeline with video, audio, text, image, and shape tracks
- Track groups with mute/visible/locked propagation
- Trim, split, join, ripple delete, and rate stretch tools
- Magnetic timeline with snapping
- Filmstrip thumbnails and audio waveform visualization
- Pre-compositions (nested compositions, 1 level deep)
- Markers for organizing your edit
- Source monitor with mark in/out and insert/overwrite edits
- Undo/redo with configurable history depth

### Effects & Animation

- **CSS filter effects** — brightness, contrast, saturation, blur, hue rotate, grayscale, sepia, invert
- **Glitch effects** — RGB split, scanlines, color glitch
- **Canvas effects** — halftone (dots, lines, rays, ripples)
- **Overlay effects** — vignette with configurable shape, softness, and color
- **Presets** — vintage, noir, cold, warm, dramatic, faded
- **Keyframe animation** — Bezier curve editor, easing functions (linear, ease-in/out, cubic-bezier, spring), auto-keyframe mode
- **Transitions** — fade, wipe, slide, 3D flip, clock wipe, iris — each with directional variants and adjustable duration/alignment

### Preview & Playback

- Real-time canvas preview with transform gizmo (drag, resize, rotate)
- Frame-accurate playback via custom Clock engine
- Snap guides and timecode display

### Export

- In-browser rendering via WebCodecs (no server required)
- **Video:** MP4, MOV, WebM, MKV
- **Audio-only:** MP3, AAC, WAV
- **Codecs:** H.264, H.265, VP8, VP9, ProRes (proxy through 4444 XQ)
- Quality presets: low, medium, high, ultra

### Media

- Import via File System Access API — files are referenced, never copied
- **Video:** MP4, WebM, MOV, MKV
- **Audio:** MP3, WAV, AAC, OGG, Opus
- **Image:** JPG, PNG, GIF (animated), WebP
- Up to 5 GB per file
- OPFS proxy video generation for smooth preview
- Media relinking for moved or deleted files

### Other

- Native SVG shapes — rectangle, circle, triangle, ellipse, star, polygon, heart
- Text overlays with custom fonts, colors, and positioning
- Project bundles — export/import projects as ZIP files with Zod-validated schemas
- IndexedDB persistence with content-addressable storage
- Auto-save
- Configurable settings (FPS, snap, waveforms, filmstrips, preview quality, export defaults, undo depth, auto-save interval)

## Quick Start

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/walterlow/freecut.git
cd freecut
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome.

### Workflow

1. Create a project from the projects page
2. Import media by dragging files into the media library
3. Drag clips to the timeline — trim, arrange, add effects and transitions
4. Animate with the keyframe editor
5. Preview your edit in real time
6. Export directly from the browser

## Browser Support

Chrome 102+ required. FreeCut uses WebCodecs, OPFS, and the File System Access API which are not yet available in all browsers.

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Play / Pause | `Space` |
| Previous / Next frame | `Left` / `Right` |
| Go to start / end | `Home` / `End` |
| Split at playhead | `Alt+C` |
| Join clips | `J` |
| Delete selected | `Delete` |
| Ripple delete | `Ctrl+Delete` |
| Freeze frame | `Shift+F` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Copy / Cut / Paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| Selection tool | `V` |
| Razor tool | `C` |
| Rate stretch tool | `R` |
| Toggle snap | `S` |
| Magnetic timeline | `N` |
| Add / Remove marker | `M` / `Shift+M` |
| Add keyframe | `K` |
| Toggle keyframe editor | `Ctrl+K` |
| Group / Ungroup tracks | `Ctrl+G` / `Ctrl+Shift+G` |
| Mark In / Out | `I` / `O` |
| Insert / Overwrite edit | `,` / `.` |
| Save | `Ctrl+S` |
| Export | `Ctrl+E` |
| Zoom to fit | `Z` |

## Tech Stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) — build tool with HMR
- [Zustand](https://github.com/pmndrs/zustand) + [Zundo](https://github.com/charkour/zundo) — state management with undo/redo
- [TanStack Router](https://tanstack.com/router) — file-based type-safe routing
- [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) — styling and UI components
- [Mediabunny](https://mediabunny.dev/) — media decoding and metadata extraction
- Canvas + [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) — composition rendering and export
- [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) + [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) — local persistence
- Web Workers — heavy processing off the main thread

## Development

```bash
npm run dev            # Dev server on port 5173
npm run build          # Production build
npm run lint           # ESLint
npm run test           # Vitest (watch mode)
npm run test:run       # Vitest (single run)
npm run test:coverage  # Vitest with coverage
npm run routes         # Regenerate TanStack Router route tree
```

### Environment

```env
VITE_SHOW_DEBUG_PANEL=true   # Show debug panel in dev (default: true)
```

### Project Structure

```
src/
├── features/
│   ├── editor/          # Editor shell, toolbar, panels, stores
│   ├── timeline/        # Multi-track timeline, actions, services
│   ├── preview/         # Preview canvas, transform gizmo
│   ├── player/          # Playback engine (Clock, composition)
│   ├── export/          # WebCodecs export pipeline (Web Worker)
│   ├── effects/         # Visual effects (CSS filters, glitch, halftone, vignette)
│   ├── keyframes/       # Keyframe animation, Bezier editor, easing
│   ├── media-library/   # Media import, metadata, OPFS proxies
│   ├── project-bundle/  # Project ZIP export/import
│   ├── projects/        # Project management
│   └── settings/        # App settings
├── lib/
│   ├── composition-runtime/  # Remotion-style Sequence/Item primitives
│   ├── transitions/          # Transition renderers (CSS + canvas)
│   ├── storage/              # IndexedDB persistence
│   ├── shapes/               # SVG shape generators
│   ├── fonts/                # Font loader
│   ├── migrations/           # Data migration system
│   └── debug/                # Debug utilities
├── components/ui/       # shadcn/ui components
├── config/hotkeys.ts    # Keyboard shortcut definitions
├── routes/              # TanStack Router (file-based)
└── types/               # Shared TypeScript types
```

## Contributing

1. **Report bugs** — open an issue
2. **Suggest features** — start a discussion
3. **Submit PRs** — fork, branch, and open a pull request

## License

[MIT](LICENSE)
