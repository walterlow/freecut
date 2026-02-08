# FreeCut

**Edit videos. In your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![FreeCut Timeline Editor](./public/assets/landing/timeline.png)

FreeCut is a professional-grade video editor that runs entirely in your browser. Professional video editing, zero installation. Create stunning videos with multi-track editing, keyframe animations, real-time preview, and high-quality exports.

## Features

- **Multi-Track Timeline** - Edit video, audio, text, and shapes on separate tracks
- **Keyframe Animations** - Intuitive keyframe editor for smooth transitions and effects
- **Real-Time Preview** - See your changes instantly with smooth playback
- **Professional Effects** - Transitions, fade in/out, opacity, and animations
- **Text Overlays** - Add customizable text with fonts, colors, and positioning
- **Shape Tools** - Create rectangles, circles, polygons, and stars
- **Audio Editing** - Waveform visualization, volume control, and audio fades
- **Video Thumbnails** - Filmstrip preview for easy navigation
- **Undo/Redo** - Full history support for confident editing
- **High-Performance Storage** - Lightning-fast local storage using OPFS
- **Browser Export** - Render videos directly in your browser using WebCodecs

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/walterlow/freecut.git
cd freecut

# Install dependencies
npm install

# Copy environment config
cp .env.example .env
```

### Running FreeCut

```bash
# Start the development server
npm run dev
```

Open your browser to [http://localhost:5173](http://localhost:5173)

### Basic Workflow

1. **Create a Project** - Click "New Project" from the projects page
2. **Import Media** - Drag and drop video, audio, or image files into the media library
3. **Edit** - Drag clips to the timeline, trim, arrange, and add effects
4. **Animate** - Use the keyframe editor to add smooth transitions
5. **Preview** - Use the player to review your edits in real-time
6. **Export** - Render your final video in the browser

## Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome  | 102+ |


> **Note:** FreeCut uses modern browser APIs like OPFS (Origin Private File System) for optimal performance. Some features may not work in older browsers.

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
VITE_SHOW_DEBUG_PANEL=true    # Show/hide debug panel button (dev only)
```

See `.env.example` for complete documentation.

## Deployment

| Component | Platform | Purpose |
|-----------|----------|---------|
| Frontend | Vercel | Static hosting, CDN |


## Tech Stack

- [React](https://react.dev/) - UI framework with concurrent features
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vite](https://vitejs.dev/) - Fast build tool with HMR
- Canvas + WebCodecs - In-browser composition rendering and export
- [TanStack Router](https://tanstack.com/router) - Type-safe routing
- [Zustand](https://github.com/pmndrs/zustand) - State management
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first styling
- [Shadcn/ui](https://ui.shadcn.com/) - UI components

## Development

### Available Scripts

```bash
npm run dev        # Start development server (port 5173)
npm run build      # Build for production
npm run lint       # Run ESLint
```


## Contributing

Contributions are welcome! Here's how you can help:

1. **Report Bugs** - Open an issue describing the problem
2. **Suggest Features** - Share your ideas in the discussions
3. **Submit PRs** - Fork the repo, make your changes, and submit a pull request


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with these amazing open source projects:

- [Mediabunny](https://mediabunny.dev/) - Video processing
- [TanStack Router](https://tanstack.com/router) - Type-safe routing
- [Zustand](https://github.com/pmndrs/zustand) - State management
- [Shadcn/ui](https://ui.shadcn.com/) - UI components
- [Vite](https://vitejs.dev/) - Build tooling

---
